"use strict"

module.exports = (function () {
    var NAS = new BigNumber("1e18");
    var WIDTH = 100;
    var HEIGHT = 100;
    var TOTAL_BLOCKS = WIDTH * HEIGHT;
    var FEE_RATE = new BigNumber("0.01");
    var FEE_LEAST = NAS.mul(0.1);
    var BUY = 0;
    var SELL = 1;
    var DEFAULT_LIMIT = [0, TOTAL_BLOCKS];
    
    var BlocksContract = function () {
        LocalContractStorage.defineProperties(this, {
            author: null,
            nextOwnerId: null,
            nextOrderId: null,
            orders: null,
            blocks: null
        });
    
        LocalContractStorage.defineMapProperties(this, {
            owners: null,
            ownerIds: null,
            orderBalances: {
                stringify: function(value) {
                    return value.toString();
                },
                parse: function(value) {
                    return new BigNumber(value);
                }
            }
        });
    }
    
    BlocksContract.prototype = {
        init: function () {
            this.nextOwnerId = 0;
            this.nextOrderId = 0;
            this.orders = {};
            this.author = Blockchain.transaction.from;
            var owner = this._addOwner(this.author, {assets: TOTAL_BLOCKS});
            this.blocks = Array(TOTAL_BLOCKS).fill(owner.id);
            owner.assets = TOTAL_BLOCKS;
        },
    
        get: function () {
            var owners = {};
            var _this = this;
            this.blocks.forEach(function(ownerId){
                if (!(ownerId in owners)) {
                    owners[ownerId] = _this._getOwnerById(ownerId);
                }
            })
            return {
                owners: owners,
                blocks: this.blocks
            }
        },

        mine: function () {
            return this.owners.get(Blockchain.transaction.from);
        },
    
        /**
         * create a order
         * direction: 0-buy 1-sell
         * price: price per block
         * blocks: blocks to sell
         * limit: limit of blockCount of blocks for 1 trade. format: [min, max]
         */
        order: function (direction, price, blocks, limit) {
            var from = Blockchain.transaction.from;

            var order = {
                creator: this._getOrCreateOwner(from).id,
                direction: direction,
                price: price,
                blocks: blocks,
                limit: limit
            }

            if (price < 0.1) {
                throw new Error('ILLEGAL_PRICE');
            }

            blocks = parseBlocks(blocks);
            if (blocks.length === 0) {
                throw new Error('EMPTY_ORDER');
            }

            if (direction === SELL) {
                var owner = this.owners.get(from);
                if (!(owner && owner.assets)) {
                    throw new Error('NOTHING_TO_SELL');
                }
                this._checkOwnership(owner.id, blocks);
                return this._createOrder(order);
            } else if (direction === BUY) {
                var paying = Blockchain.transaction.value;
                var totalPrice = NAS.mul(order.price).mul(blocks.length);
                var overpay = paying.minus(totalPrice);
                if (overpay.gt(0)) {
                    // return overpay
                    this._transferNas(from, overpay);
                } else if (overpay.lt(0)) {
                    throw new Error('INSUFFICIENT_MONEY');
                }
                blocks.forEach(function(blockId){
                    if (blockId < 0 || blockId >= TOTAL_BLOCKS) {
                        throw new Error("OUT_OF_RANGE");
                    }
                });
                var newOrder = this._createOrder(order);
                this.orderBalances.set(newOrder.id, totalPrice);
                return newOrder;
            } else {
                throw new Error("UNKNOWN_DIRECTION:" + direction);
            }
        },

        /**
         * cancel an order
         */
        cancel: function (orderId) {
            var from = Blockchain.transaction.from;
            var owner = this.owners.get(from);
            if (!(owner && this.orders[orderId].creator === owner.id)) {
                throw new Error('WRONG_ORDER_OWNERSHIP');
            }
            var balance = this.orderBalances.get(orderId);
            if (balance && balance.gt(0)) {
                this._transferNas(from, balance);
            }
            this.orderBalances.del(orderId);
            var orders = this.orders;
            delete(orders[orderId]);
            this.orders = orders;
        },

        /**
         * market: list all orders
         */
        market: function (){
            return this.orders;
        },
    
        /**
         * trade order
         * direction: 0-buy 1-sell
         * sellingId: sellingId
         * blocks: blocks to buy
         */
        trade: function (direction, orderId, blocks) {
            var order = this.orders[orderId];
            if (!(order && order.blocks && order.direction === direction)) {
                throw new Error('ORDER_UNAVAILABLE');
            }
            var opponent = this.ownerIds.get(order.creator);
    
            blocks = parseBlocks(blocks);
            var blockCount = blocks.length;
            var limit = order.limit || DEFAULT_LIMIT;
            if (blockCount < limit[0] || blockCount > limit[1]) {
                throw new Error('OUT_OF_RANGE:[' + limit[0] + ', ' + limit[1] + ']');
            }
    
            var from = Blockchain.transaction.from;
            var totalPrice = NAS.mul(order.price).mul(blockCount);
            var fee = totalPrice.mul(FEE_RATE);
            if (fee.lt(FEE_LEAST)) {
                fee = FEE_LEAST;
            }
            // money to author
            this._transferNas(this.author, fee);

            if (direction === BUY) {
                // i'm selling because the order is BUY

                // order balance
                var balance = this.orderBalances.get(orderId);
                balance = balance.minus(totalPrice);
                if (balance.lt(0)) {
                    throw new Error('INSUFFICIENT_MONEY');
                }
                this.orderBalances.set(orderId, balance);

                // money to seller (me)
                this._transferNas(from, totalPrice.minus(fee));
                // blocks to buyer (opponent)
                this._transferBlocks(from, opponent, blocks);

                // remove blocks from my sell order
                var ownerId = this.owners.get(from).id;
                var orders = this.orders;
                for (var orderId in orders) {
                    var order = orders[orderId];
                    if (order.direction === SELL && order.creator === ownerId) {
                        this._removeOrderBlocks(order, blocks, false);
                        break;
                    }
                };
            } else {
                // i'm buying because the order is SELL

                // money to seller (opponent)
                this._transferNas(opponent, totalPrice);
                // blocks to buyer (me)
                this._transferBlocks(opponent, from, blocks);

                var paying = Blockchain.transaction.value;
                var totalPay = totalPrice.plus(fee);
                var overpay = paying.minus(totalPay);
                if (overpay.gt(0)) {
                    // return overpay
                    this._transferNas(from, overpay);
                } else if (overpay.lt(0)) {
                    throw new Error('INSUFFICIENT_MONEY');
                }
            }
            this._removeOrderBlocks(order, blocks, true);
        },

        /*
         * remove blocks from order
         */
        _removeOrderBlocks: function (order, blocks, checkRange) {
            // remove sold blocks from order.blocks
            var blocksInOrderStatus = {};
            var blocksInOrder = parseBlocks(order.blocks);
            blocksInOrder.forEach(function(blockId){
                blocksInOrderStatus[blockId] = true;
            });
            blocks.forEach(function(blockId){
                if (blocksInOrderStatus[blockId]) {
                    blocksInOrderStatus[blockId] = false;
                } else if (checkRange) {
                    throw new Error('OUT_OF_RANGE:' + blockId);
                }
            });
            blocksInOrder = blocksInOrder.filter(function(blockId){
                return blocksInOrderStatus[blockId];
            });
            var orders = this.orders;
            if (blocksInOrder.length > 0) {
                order.blocks = stringifyBlocks(blocksInOrder);
                orders[order.id] = order;
            } else {
                delete(orders[order.id]);
            }
            this.orders = orders;
        },
    
        configure: function(config) {
            this._configure(Blockchain.transaction.from, config);
        },

        withdraw: function(amount) {
            _transferNas(this.author, new BigNumber(amount));
        },

        _transferNas: function(to, amount) {
            Blockchain.transfer(to, amount);
            Event.Trigger("Blocks", {
                Transfer: {
                    from: Blockchain.transaction.to,
                    to: to,
                    value: amount.toString()
                }
            });
        },
    
        _checkOwnership: function (ownerId, blocks) {
            var _this = this;
            blocks.forEach(function (blockId) {
                if (_this.blocks[blockId] !== ownerId) {
                    throw new Error('WRONG_OWNERSHIP:' + blockId);
                }
            });
        },

        _getOwnerById: function (ownerId) {
            return this.owners.get(this.ownerIds.get(ownerId));
        },

        _getOrCreateOwner: function(account) {
            var owner = this.owners.get(account);
            if (!owner) {
                return this._addOwner(account);
            }
            return owner;
        },
    
        _addOwner: function (account, data) {
            var ownerId = this.nextOwnerId++;
            var owner = data || {assets: 0};
            owner.id = ownerId;
            this.ownerIds.set(ownerId, account);
            this.owners.set(account, owner);
            return owner;
        },

        _createOrder: function (newOrder) {
            // check duplication
            var blockInNewOrder = {};
            parseBlocks(newOrder.blocks).forEach(function (blockId) {
                blockInNewOrder[blockId] = true;
            });

            var orders = this.orders;

            for (var orderId in orders) {
                var order = orders[orderId];
                if (order.direction === newOrder.direction && order.creator === newOrder.creator) {
                    parseBlocks(order.blocks).forEach(function (blockId) {
                        if (blockInNewOrder[blockId]) {
                            throw new Error('DUP_ORDER_BLOCK');
                        }
                    });
                }
            };

            newOrder.id = this.nextOrderId++;
            orders[newOrder.id] = newOrder;
            this.orders = orders;
            return newOrder;
        },
    
        _configure: function(account, config) {
            var owner = this.owners.get(account);
            if (!owner) {
                throw new Error('OWN_NOTHING');
            }
    
            for (var k in config) {
                if (k != 'id' && k != 'asset' && k != 'loaded') {
                    owner[k] = config[k];
                }
            }
    
            this.owners.set(account, owner);
        },
    
       _transferBlocks: function (from, to, blocks) {
           var allBlocks = this.blocks;
           var fromOwner = this.owners.get(from);
           var toOwner = this._getOrCreateOwner(to);
    
           blocks.forEach(function (blockId) {
               if (allBlocks[blockId] !== fromOwner.id) {
                   throw new Error('WRONG_OWNERSHIP:' + blockId);
               }
               allBlocks[blockId] = toOwner.id;
           });
           this.blocks = allBlocks;
           fromOwner.assets -= blocks.length;
           toOwner.assets += blocks.length;
           this.owners.set(from, fromOwner);
           this.owners.set(to, toOwner);
       }
    }
    return BlocksContract;
})();
