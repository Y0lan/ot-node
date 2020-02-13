const utilities = require('../Utilities');
const Models = require('../../models');
const Utilities = require('../Utilities');
const ImportUtilities = require('../ImportUtilities');

/**
 * DC related API controller
 */
class DCController {
    constructor(ctx) {
        this.logger = ctx.logger;
        this.emitter = ctx.emitter;
        this.apiUtilities = ctx.apiUtilities;
        this.config = ctx.config;
        this.dcService = ctx.dcService;
        this.remoteControl = ctx.remoteControl;
        this.graphStorage = ctx.graphStorage;
        this.transport = ctx.transport;
        this.importService = ctx.importService;
        this.web3 = ctx.web3;
    }

    /**
     * Validate create offer request and import
     *
     * @param req   HTTP request
     * @param res   HTTP response
     */
    async handleReplicateRequest(req, res) {
        if (req.body !== undefined && req.body.dataset_id !== undefined && typeof req.body.dataset_id === 'string' &&
            utilities.validateNumberParameter(req.body.holding_time_in_minutes) &&
            utilities.validateStringParameter(req.body.token_amount_per_holder) &&
            utilities.validateNumberParameter(req.body.litigation_interval_in_minutes)) {
            var handlerId = null;
            try {
                const dataset = await Models.data_info.findOne({
                    where: { data_set_id: req.body.dataset_id },
                });
                if (dataset == null) {
                    this.logger.info('Invalid request');
                    res.status(400);
                    res.send({
                        message: 'This data set does not exist in the database',
                    });
                    return;
                }

                const inserted_object = await Models.handler_ids.create({
                    status: 'PENDING',

                });
                handlerId = inserted_object.dataValues.handler_id;
                const offerId = await this.dcService.createOffer(
                    req.body.dataset_id, dataset.root_hash, req.body.holding_time_in_minutes,
                    req.body.token_amount_per_holder, dataset.otjson_size_in_bytes,
                    req.body.litigation_interval_in_minutes, handlerId,
                    req.body.urgent,
                );
                const handler_data = {
                    status: 'PUBLISHING_TO_BLOCKCHAIN',
                    offer_id: offerId,
                };
                await Models.handler_ids.update({
                    data: JSON.stringify(handler_data),
                }, {
                    where: {
                        handler_id: handlerId,
                    },
                });
                res.status(200);
                res.send({
                    handler_id: handlerId,
                });
            } catch (error) {
                this.logger.error(`Failed to create offer. ${error}.`);
                if (handlerId) {
                    Models.handler_ids.update({
                        status: 'FAILED',
                    }, { where: { handler_id: handlerId } });
                }
                res.status(400);
                res.send({
                    message: `Failed to start offer. ${error}.`,
                });
                this.remoteControl.failedToCreateOffer(`Failed to start offer. ${error}.`);
            }
        } else {
            this.logger.error('Invalid request');
            res.status(400);
            res.send({
                message: 'Invalid parameters!',
            });
        }
    }

    async handlePrivateDataReadRequest(message) {
        const {
            handler_id, nodeId, data_set_id, wallet,
        } = message;
        const replyId = message.id;

        const networkReply = await Models.network_replies.find({ where: { id: replyId } });
        if (!networkReply) {
            throw Error(`Couldn't find reply with ID ${replyId}.`);
        }

        if (networkReply.receiver_wallet !== wallet &&
            networkReply.receiver_identity) {
            throw Error('Sorry not your read request');
        }

        const objectIds = [];
        const datasetIds = [];
        networkReply.data.imports.forEach((imports) => {
            if (imports.private_data) {
                datasetIds.push(imports.data_set_id);
                imports.private_data.forEach((privateData) => {
                    objectIds.push(privateData.ot_object_id);
                });
            }
        });
        if (objectIds.length <= 0 || datasetIds <= 0) {
            throw Error('No private data to read');
        }

        const privateDataPermissions = await Models.private_data_permissions.findAll({
            where: {
                data_set_id,
                ot_json_object_id: { [Models.Sequelize.Op.in]: objectIds },
                node_id: nodeId,
            },
        });
        if (!privateDataPermissions || privateDataPermissions.length === 0) {
            throw Error(`You don't have permission to view objectIds: ${objectIds} from dataset: ${data_set_id}`);
        }

        const replayMessage = {
            wallet: this.config.node_wallet,
            handler_id,
        };
        const promises = [];
        privateDataPermissions.forEach((privateDataPermisssion) => {
            promises.push(this.graphStorage.findDocumentsByImportIdAndOtObjectId(
                data_set_id,
                privateDataPermisssion.ot_json_object_id,
            ));
        });
        const otObjects = await Promise.all(promises);
        replayMessage.ot_objects = otObjects;

        const privateDataReadResponseObject = {
            message: replayMessage,
            messageSignature: Utilities.generateRsvSignature(
                JSON.stringify(replayMessage),
                this.web3,
                this.config.node_private_key,
            ),
        };
        await this.transport.sendPrivateDataReadResponse(
            privateDataReadResponseObject,
            nodeId,
        );
    }

    async handleNetworkPurchaseRequest(message) {
        const {
            data_set_id, handler_id, dv_node_id, ot_json_object_id,
        } = message;

        await Models.private_data_permissions.create({
            node_id: dv_node_id,
            data_set_id,
            ot_json_object_id,
        });
        const response = {
            handler_id,
            status: 'SUCCESS',
            wallet: this.config.node_wallet,
            message: 'Data purchase successfully finalized!',
        };

        const dataPurchaseResponseObject = {
            message: response,
            messageSignature: Utilities.generateRsvSignature(
                JSON.stringify(response),
                this.web3,
                this.config.node_private_key,
            ),
        };

        await this.transport.sendDataPurchaseResponse(
            dataPurchaseResponseObject,
            dv_node_id,
        );
    }
}

module.exports = DCController;

