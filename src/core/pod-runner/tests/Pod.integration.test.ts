import Pod from "../Pod"
import setUpNode from "../../set-up-node/setUpNode"
import { database } from "containeros-sdk"
import sinon from "sinon"
import * as dockerUtils from "../../../lib/docker/dockerodeUtils"
import dockerode from "../../../lib/docker/dockerode"
import { StoredPodStatus, keyable } from "containeros-sdk"

import { expect } from "chai"
import { after } from "mocha"
import delay from "delay"

const randomNumber = 12347//Math.floor(Math.random() * 100000)
const POD_NAME = `pod-${randomNumber}`

async function cleanUp() {
    await dockerUtils.removeContainerHelper(POD_NAME + '-mycont', 0)
    await dockerUtils.removeContainerHelper(POD_NAME + '-2' + '-mycont', 0)
    await database.podStatus.dropAll()
    await database.services.deregisterAllServices()
}

describe('Pod runner integration test', function () {
    this.timeout(30000)
    before(async () => {
        sinon.restore()
        await setUpNode()
    })

    beforeEach(async () => {
        await cleanUp()
    })
    afterEach(async () => {
        await cleanUp()
    })

    it('registers consul service', async () => {
        let services = await database.services.getList()
        expect(Object.keys(services).length).to.equal(0)

        const pod = new Pod({
            name: "fake-server/" + POD_NAME,
            parentName: 'fake-deployment-123',
            containers: [
                {
                    name: "mycont",
                    image: "tutum/hello-world",
                    services: { 80: 'my-service-1' },
                    memLimit: 100000000,
                    cpus: 150000,
                    env: []
                }],
        })

        await pod.awaitForStart()
        services = await database.services.getList()
        expect(Object.keys(services).length).to.equal(1)
        expect(Object.values(services)[0].Service).to.equal(`my-service-1`)
    })

    it('removes consul service on pod removal', async () => {
        let services = await database.services.getList()
        expect(Object.keys(services).length).to.equal(0)

        const pod = new Pod({
            name: "fake-server/" + POD_NAME,
            parentName: 'fake-deployment-123',
            containers: [
                {
                    name: "mycont",
                    image: "tutum/hello-world",
                    services: { 80: 'my-service-2' },
                    memLimit: 100000000,
                    cpus: 150000,
                    env: []
                }],
        })

        await pod.awaitForStart()
        services = await database.services.getList()
        expect(Object.keys(services).length).to.equal(1)
        expect(Object.values(services)[0].Service).to.equal(`my-service-2`)

        await pod.stop(true)
        services = await database.services.getList()
        expect(Object.keys(services).length).to.equal(0)
    })

    it('registers 2 containers with the same service name', async () => {
        let services = await database.services.getList()
        expect(Object.keys(services).length).to.equal(0)

        const pod1 = new Pod({
            name: "fake-server/" + POD_NAME,
            parentName: 'fake-deployment-123',
            containers: [
                {
                    name: "mycont",
                    image: "tutum/hello-world",
                    services: { 80: 'my-service-3' },
                    memLimit: 100000000,
                    cpus: 150000,
                    env: []
                }],
        })
        const pod2 = new Pod({
            name: "fake-server/" + POD_NAME + '-2',
            parentName: 'fake-deployment-123',
            containers: [
                {
                    name: "mycont",
                    image: "tutum/hello-world",
                    services: { 80: 'my-service-3' },
                    memLimit: 100000000,
                    cpus: 150000,
                    env: []
                }],
        })

        await pod1.awaitForStart()
        await pod2.awaitForStart()

        services = await database.services.getList()
        expect(Object.keys(services).length).to.equal(2)
        expect(Object.values(services)[0].Service).to.equal(`my-service-3`)
        expect(Object.values(services)[1].Service).to.equal(`my-service-3`)
    })
})