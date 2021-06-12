import Dockerode from "dockerode"
import { UNTOUCHABLE_CONTAINERS } from "../../config"
import { containerStatus, keyable } from "../../definitions"

const docker = new Dockerode()

export default async function sync(containersToStart: Array<Dockerode.ContainerCreateOptions>): Promise<CreateContainerResult> {
    await deleteChangedContainers(containersToStart)
    return await createAbsentContainers(containersToStart)
}

type CreateContainerResult = keyable<containerStatus>

async function createAbsentContainers(containersToStart: Array<Dockerode.ContainerCreateOptions>): Promise<CreateContainerResult> {
    const containersOnHost = await docker.listContainers({ all: true });

    const results: CreateContainerResult = {}

    for (let container of containersToStart) {
        if (!hostHasContainer(containersOnHost, container.name!)) {
            try {
                await runContainer(container);
                results[container.name] = "ok"
            } catch (e) {
                if (e instanceof ContainerPullingError) {
                    results[container.name] = "error_pulling"
                } else {
                    throw e //something goes sideways. it's better to die actually
                }
            }
        }
    }

    return results
}

class ContainerPullingError extends Error { }

async function deleteChangedContainers(containersToStart: Array<Dockerode.ContainerCreateOptions>): Promise<void> {
    const containersOnHost = await docker.listContainers({ all: true });
    // delete changed and absent containers
    for (let containerOnHost of containersOnHost) {
        if (UNTOUCHABLE_CONTAINERS.indexOf(containerOnHost.Names[0]) !== -1) {
            continue;
        }
        let shouldBeDeleted = true
        for (let containerToStart of containersToStart) {
            //should not be deleted only if specs are the same

            if (!areSpecsDifferent(containerToStart, containerOnHost)) {
                shouldBeDeleted = false
            }
        }
        if (shouldBeDeleted) {
            const containerToDelete = await docker.getContainer(containerOnHost.Id)
            try {
                await containerToDelete.stop()
            } catch (e) {
                if (e.reason !== 'container already stopped') {
                    throw e
                }
            }
            try {
                await containerToDelete.remove()
            } catch (e) {
                if (!String(e?.json?.message).endsWith("is already in progress")) {
                    throw e
                }
            }
        }
    }
}

function areSpecsDifferent(newContainer: Dockerode.ContainerCreateOptions, existingContainer: Dockerode.ContainerInfo) {
    if ('/' + newContainer.name !== existingContainer.Names[0]) {
        return true // this has to be the first comparison
    }
    if (newContainer.Image !== existingContainer.Image) {
        return true
    }
    if (newContainer?.HostConfig?.NetworkMode !== existingContainer?.HostConfig?.NetworkMode) {
        return true
    }

    //TODO: check cmd
    //TODO: check env
    return false
}

async function dockerPull(image: string): Promise<void> {
    return new Promise((resolve, reject) => {
        docker.pull(image, function (err: any, stream: any) {
            if (err) reject(new ContainerPullingError("ContainerPullingError"))

            docker.modem.followProgress(stream, onFinished, () => null);

            function onFinished(err: any, output: any) {
                if (err) reject(new ContainerPullingError("ContainerPullingError"))
                else resolve(output)
            }
        });
    })
}

async function runContainer(containerToCreate: Dockerode.ContainerCreateOptions) {
    await dockerPull(containerToCreate.Image!);
    const createdContainer = await docker.createContainer(containerToCreate)
    await createdContainer.start()
}

function hostHasContainer(containerList: Dockerode.ContainerInfo[], name: string): Boolean {
    return containerList.filter(line => line.Names[0] === '/' + name).length > 0
}