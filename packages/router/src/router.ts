import { createServer, IncomingMessage, ServerResponse } from "http"
import { createRedisClient, ServiceInfo } from "service-registry-redis"
import { ServiceCatalog } from "service-registry-redis/out/ServiceCatalog"

async function main() {
  const redisClient = createRedisClient()
  const catalog = new ServiceCatalog(redisClient)
  await catalog.listen()

  const server = createServer(((request, response) => {
    const url = request.url
    if (url === "/" || url == null || url.length === 0 || url.startsWith("/find-build-agent")) {
      handleRequest(response, request, catalog)
        .then(result => {
          response.statusCode = 200
          response.end(result)
        })
        .catch(error => {
          console.error(error.stack || error.toString())
          response.statusCode = 500
          response.end()
        })
    }
    else {
      console.error(`Unsupported route: ${url}`)
      response.statusCode = 404
      response.end()
    }
  }))

  require("async-exit-hook")((callback: (() => void) | null) => {
    console.log("Exit signal received, stopping server and queue")

    let serverClosed = false
    const closed = (label: string) => {
      console.log(label)
      if (serverClosed && callback != null) {
        callback()
      }
    }

    server.close(() => {
      serverClosed = true
      closed("Server stopped")
    })
  })

  await new Promise((resolve, reject) => {
    server.on("error", reject)
    const explicitPort = process.env.ELECTRON_BUILD_SERVICE_ROUTER_PORT
    const port = explicitPort ? parseInt(explicitPort!, 10) : 80
    server.listen(port, () => {
      console.log(`Server listening on ${server.address().address}:${server.address().port}`)
      resolve()
    })
  })
}

function getWeight(agent: ServiceInfo): number {
  return agent.jobCount / agent.cpuCount
}

export function sortList(list: Array<ServiceInfo>) {
  if (list.length > 1) {
    list.sort((a, b) => getWeight(a) - getWeight(b))
    // if first agent weight equals to last, it means that all agents are free and no need to ignore any agent
    if (getWeight(list[0]) !== getWeight(list[list.length - 1])) {
      return list.slice(0, Math.ceil(list.length / 2))
    }
  }
  return list
}

async function handleRequest(response: ServerResponse, request: IncomingMessage, catalog: ServiceCatalog) {
  const list = sortList(await catalog.getServices())
  if (list.length === 0) {
    console.error("No running build agents")
    response.statusCode = 503
    response.end('{"error: "No running build agents"}')
    return
  }

  // todo take geo position in account
  const service = list[Math.floor(Math.random() * list.length)]
  return `{"endpoint": "https://${service.ip}:${service.port || 443}"}`
}

if (process.mainModule === module) {
  main()
    .catch(error => {
      console.error(error.stack || error)
      process.exit(1)
    })
}