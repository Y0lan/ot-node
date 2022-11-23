import Command from '../../../command.js';
import { OPERATION_ID_STATUS } from '../../../../constants/constants.js';

class CalculateProofsCommand extends Command {
    constructor(ctx) {
        super(ctx);
        this.commandExecutor = ctx.commandExecutor;
        this.validationModuleManager = ctx.validationModuleManager;
        this.blockchainModuleManager = ctx.blockchainModuleManager;
        this.operationIdService = ctx.operationIdService;
    }

    async execute(command) {
        const {
            blockchain,
            contract,
            tokenId,
            keyword,
            hashFunctionId,
            serviceAgreement,
            epoch,
            agreementId,
            identityId,
            operationId,
        } = command.data;

        this.logger.trace(
            `Started calculate proofs command for agreement id: ${agreementId} contract: ${contract}, token id: ${tokenId}, keyword: ${keyword}, hash function id: ${hashFunctionId}`,
        );
        this.operationIdService.emitChangeEvent(
            OPERATION_ID_STATUS.COMMIT_PROOF.CALCULATE_PROOFS_START,
            operationId,
            agreementId,
            epoch,
        );
        if (
            !(await this.isEligibleForRewards(blockchain, agreementId, epoch, identityId)) ||
            !(await this.blockchainModuleManager.isProofWindowOpen(agreementId, epoch))
        ) {
            await this.scheduleNextEpochCheck(
                blockchain,
                agreementId,
                contract,
                tokenId,
                epoch,
                serviceAgreement,
            );
        } else {
            this.logger.trace(
                `Proof window is open and node is eligible for rewards. Calculating proofs for agreement id : ${agreementId}`,
            );
            const { assertionId, challenge } = await this.blockchainModuleManager.getChallenge(
                blockchain,
                contract,
                tokenId,
                keyword,
                hashFunctionId,
            );

            const { leaf, proof } = await this.validationModuleManager.getMerkleProof(
                await this.tripleStoreModuleManager.get(assertionId),
                challenge,
            );

            await this.commandExecutor.add({
                name: 'submitProofsCommand',
                delay: 0,
                data: {
                    leaf,
                    proof,
                },
                transactional: false,
            });
        }
        this.operationIdService.emitChangeEvent(
            OPERATION_ID_STATUS.COMMIT_PROOF.CALCULATE_PROOFS_END,
            operationId,
            agreementId,
            epoch,
        );
        return Command.empty();
    }

    async isEligibleForRewards(blockchain, agreementId, epoch, identityId) {
        const commits = await this.blockchainModuleManager.getCommitSubmissions(
            blockchain,
            agreementId,
            epoch,
        );

        const r0 = await this.blockchainModuleManager.getR0(blockchain);
        commits.slice(0, r0).forEach((commit) => {
            if (commit.identityId === identityId) {
                this.logger.trace(`Node is eligible for rewards for agreement id: ${agreementId}`);
                return true;
            }
        });

        this.logger.trace(`Node is not eligible for rewards for agreement id: ${agreementId}`);

        return false;
    }

    async scheduleNextEpochCheck(
        blockchain,
        agreementId,
        contract,
        tokenId,
        keyword,
        epoch,
        hashFunctionId,
        serviceAgreement,
    ) {
        const nextEpochStartTime =
            serviceAgreement.startTime + serviceAgreement.epochLength * epoch;
        await this.commandExecutor.add({
            name: 'epochCheckCommand',
            sequence: [],
            delay: nextEpochStartTime - Math.floor(Date.now() / 1000),
            data: {
                blockchain,
                agreementId,
                contract,
                tokenId,
                keyword,
                epoch: epoch + 1,
                hashFunctionId,
                serviceAgreement,
            },
            transactional: false,
        });
    }

    /**
     * Builds default calculateProofsCommand
     * @param map
     * @returns {{add, data: *, delay: *, deadline: *}}
     */
    default(map) {
        const command = {
            name: 'calculateProofsCommand',
            delay: 0,
            transactional: false,
        };
        Object.assign(command, map);
        return command;
    }
}

export default CalculateProofsCommand;
