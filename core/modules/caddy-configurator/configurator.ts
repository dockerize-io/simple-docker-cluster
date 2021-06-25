import { Thenable } from "consul";
import { object } from "superstruct";
import { keyable } from "../../definitions";
import consul from "../../lib/database/consulInstance"
import axios from "axios"

//TODO: this whole configurator should be just a caddy plugin

async function start() {
    console.log('caddy configurator starting')

    var watch = consul.watch({
        method: consul.health.state,
        options: { state: 'any' },
        backoffFactor: 1000,
        maxAttempts: 500
    });

    watch.on('change', async function (data, res) {
        const passingServices: Set<string> = new Set()
        const notPassingServices: Set<string> = new Set()

        for (let check of data) {
            for (let tag of check.ServiceTags) {
                if (tag.startsWith('routerDomain-')) {
                    if (check.Status === 'passing') {
                        passingServices.add(check.ServiceName)
                    } else {
                        notPassingServices.add(check.ServiceName)
                    }
                }
            }
        }

        //if any of service health checks are passing, that's ok
        [...passingServices].map(item => notPassingServices.delete(item))


        //TODO: a lot of load on consul here. optimize
        const nodesPromises: Thenable<any[]>[] = [...passingServices].map(serviceName => consul.catalog.service.nodes(serviceName))
        const nodesReponses: any[][] = await Promise.all(nodesPromises)

        const domainsToIps = {}
        for (let response of nodesReponses) {
            for (let serviceInstance of response) {
                const domain = serviceInstance.ServiceTags
                    .filter(domain => domain.startsWith('routerDomain-'))[0]
                    .replace('routerDomain-', '')
                console.log('domain', domain)
                if (!domainsToIps[domain]) domainsToIps[domain] = []
                domainsToIps[domain].push(`${serviceInstance.Address}:${serviceInstance.ServicePort}`)
            }
        }

        const caddyConf = {
            "listen": [":443"],
            "routes": []
        }
        for (let domain of Object.keys(domainsToIps)) {
            caddyConf.routes.push({
                "handle": [{
                    "handler": "subroute",
                    "routes": [{
                        "handle": domainsToIps[domain].map(address => ({
                            "handler": "reverse_proxy", "upstreams": [{ "dial": address }]
                        }))
                    }]
                }],
                "match": [{ "host": [domain] }],
                "terminal": true
            })
        }

        await axios.post("http://localhost:2019/config/apps/http/servers/srv0/", caddyConf)
    });

    watch.on('error',
        function (err) {
            console.error(`watch error on consul.health.state:`,
                err);
            process.exit(1)
        });
}

export default { start }

if (require.main === module) {
    process.on('unhandledRejection',
        (reason,
            p) => {
            console.error('Unhandled Rejection at:',
                p,
                'reason:',
                reason)
            process.exit(1)
        });

    start();
}
