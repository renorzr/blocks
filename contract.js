"use strict"

module.exports = (function () {
    var NAS = new BigNumber("1e18");
    var FEE_RATE = new BigNumber("0.03");
    var FEE_LOWEST= NAS.mul('0.1');
    var DEFAULT_LIMIT = [0, TOTAL_BLOCKS];
    
    var BlocksContract = function () {
        LocalContractStorage.defineProperties(this, {
            author: null,
            nextDistrictId: null,
            nextOrderId: null,
            blocks: null,
            lastPrice: null
        });
    
        LocalContractStorage.defineMapProperties(this, {
            orders: null,       // orderId: {_id: 1, blocks: "AAA"}
            config: null,       // districtId: {img: ...}
            districts: null,    // districtId: {_id: districtId, _subs:{}} 
            districtIds: null,  // districtId: districtName
            subs: null,         // account: {subDistName: subDistId}
            districtRatings: null, // districtId: [{comment: '...', rating: 4, donate: 0.1}]
            orderLocks: null,  // blockId: true
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
            this.nextDistrictId = 0;
            this.nextOrderId = 0;
            this.author = Blockchain.transaction.from;
            var district = this._addDistrict(this.author);
            this.blocks = Array(TOTAL_BLOCKS).fill(district._id);
        },
    
        get: function () {
            var districts = {};
            var _this = this;
            this.blocks.forEach(function(districtId){
                if (!(districtId in districts)) {
                    districts[districtId] = _this._getDistrictById(districtId);
                }
            })
            return {
                districts: districts,
                blocks: this.blocks
            }
        },

        getConfig: function (districtId) {
            return this.config.get(districtId);
        },

        mine: function () {
            var account = Blockchain.transaction.from;
            var result = this.districts.get(account) || {};
            result._subs = this.subs.get(account);
            return result;
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
                creator: this._getOrCreateDistrict(from)._id,
                direction: direction,
                price: price,
                blocks: blocks,
                limit: limit,
                createdAt: Date.now()
            }

            if (price < LOWEST_PRICE) {
                throw new Error('ILLEGAL_PRICE');
            }

            blocks = parseBlocks(blocks);
            if (blocks.length === 0) {
                throw new Error('EMPTY_ORDER');
            }

            if (direction === SELL) {
                var district = this.districts.get(from);
                var subs = this.subs.get(from);
                var districtIds = {};
                districtIds[district._id] = true;
                this._ensureBlocksInDistricts(districtIds, blocks);
                return this._createOrder(order);
            } else if (direction === BUY) {
                var paying = Blockchain.transaction.value;
                var totalPrice = NAS.mul(order.price).mul(blocks.length);
                var overpay = paying.minus(totalPrice);
                if (overpay.gt(0)) {
                    // return overpay
                    _transferNas(from, overpay);
                } else if (overpay.lt(0)) {
                    throw new Error('INSUFFICIENT_MONEY');
                }
                blocks.forEach(function(blockId){
                    if (blockId < 0 || blockId >= TOTAL_BLOCKS) {
                        throw new Error("OUT_OF_RANGE");
                    }
                });
                var newOrder = this._createOrder(order);
                this.orderBalances.set(newOrder._id, totalPrice);
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
            var district = this.districts.get(from);
            var order = this.orders.get(orderId);
            if (!(district && order && order.creator === district._id)) {
                throw new Error('WRONG_ORDER_OWNERSHIP');
            }
            var balance = this.orderBalances.get(orderId);
            if (balance && balance.gt(0)) {
                _transferNas(from, balance);
            }
            this.orderBalances.del(orderId);
            this.orders.del(orderId);
        },

        /**
         * market: list all orders
         */
        market: function (filter, endId, limit){
            if (!filter) filter = {};
            var id = endId === undefined ? this.nextOrderId  - 1 : endId;
            limit = limit || 100;
            var result = [];
            while (id >= 0 && result.length < limit) {
                var order = this.orders.get(id--);
                if (order
                    && (filter.creator == null || filter.creator === order.creator)
                    && (filter.direction == null || filter.direction === order.direction)
                    && (filter.price_gt == null || order.price > filter.price_gt)
                    && (filter.price_lt == null || order.price < filter.price_lt)
                    && (filter.price_gte == null || order.price >= filter.price_gte)
                    && (filter.price_lte == null || order.price <= filter.price_lte)
                ) {
                    result.push(order);
                }
            }
            return {
                orders: result,
                lastPrice: this.lastPrice
            };
        },
    
        /**
         * trade order
         * direction: 0-buy 1-sell
         * sellingId: sellingId
         * blocks: blocks to buy
         */
        trade: function (direction, orderId, blocks) {
            var order = this.orders.get(orderId);
            if (!(order && order.blocks && order.direction === direction)) {
                throw new Error('ORDER_UNAVAILABLE');
            }
            var opponent = this.districtIds.get(order.creator);
    
            blocks = parseBlocks(blocks);
            var blockCount = blocks.length;
            var limit = order.limit || DEFAULT_LIMIT;
            if (blockCount < limit[0] || blockCount > limit[1]) {
                throw new Error('OUT_OF_RANGE:[' + limit[0] + ', ' + limit[1] + ']');
            }
    
            var from = Blockchain.transaction.from;
            var totalPrice = NAS.mul(order.price).mul(blockCount);
            var fee = totalPrice.mul(FEE_RATE);
            if (fee.lt(FEE_LOWEST)) {
                fee = FEE_LOWEST;
            }
            // money to author
            _transferNas(this.author, fee);

            this._removeOrderBlocks(order, blocks, true);
            this.lastPrice = order.price;
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
                _transferNas(from, totalPrice.minus(fee));
                // blocks to buyer (opponent)
                this._transferBlocks(from, opponent, blocks, true);

                // remove blocks from my sell order
                var districtId = this.districts.get(from)._id;
                for (var i = 0; i < this.nextOrderId; i++) {
                    var order = this.orders.get(i);
                    if (order && order.direction === SELL && order.creator === districtId) {
                        this._removeOrderBlocks(order, blocks, false);
                        break;
                    }
                };
            } else {
                // i'm buying because the order is SELL

                // money to seller (opponent)
                _transferNas(opponent, totalPrice);
                // blocks to buyer (me)
                this._transferBlocks(opponent, from, blocks, true);

                var paying = Blockchain.transaction.value;
                var totalPay = totalPrice.plus(fee);
                var overpay = paying.minus(totalPay);
                if (overpay.gt(0)) {
                    // return overpay
                    _transferNas(from, overpay);
                } else if (overpay.lt(0)) {
                    throw new Error('INSUFFICIENT_MONEY');
                }
            }
        },
    
        configure: function(sub, config) {
            this._configure(_districtFullName(Blockchain.transaction.from, sub), config);
        },

        transferBlocks: function(fromDistName, toDistName, blockString) {
            var account = Blockchain.transaction.from;
            var blocks = parseBlocks(blockString);
            var fromDistFullName = _districtFullName(account, fromDistName);
            this._transferBlocks(
                fromDistFullName,
                _districtFullName(account, toDistName),
                blocks 
            );
            if (fromDistName) {
                // transferring from a sub district
                var subDist = this.districts.get(fromDistFullName);
                if (this.blocks.indexOf(subDist._id) == -1) {
                    // district has no blocks, remove the sub district
                    var mainDist = this.districts.get(account);
                    var subs = this.subs.get(account);
                    delete(subs[fromDistName]);
                    this.subs.set(account, subs);
                    this.districts.set(account, mainDist);
                    this.districtIds.del(subDist._id);
                    this.districts.del(fromDistFullName);
                    this.config.del(subDist._id);
                }
            }
        },

        rating: function (districtId, rating, comment) {
            if (rating < 0.5 || rating > 5) {
                throw new Error('WRONG_RATING');
            }
            if (comment.length > 200) {
                throw new Error('TOO_LONG_CONTENT');
            }
            var donate = Blockchain.transaction.value.div(NAS);
            var districtFullName = this.districtIds.get(districtId);
            var to = districtFullName.split(':')[0];
            var ratings = this.districtRatings.get(districtId) || [];
            ratings.push({
                account: Blockchain.transaction.from,
                rating: rating,
                comment: comment,
                donate: donate,
                createdAt: Date.now()
            });
            this.districtRatings.set(districtId, ratings);
            if (donate.gt(0)) {
                _transferNas(to, donate);
            }
        },

        ratings: function (districtId, since) {
            var ratings = this.districtRatings.get(districtId) || [];
            var result = [];
            for (var i = ratings.length - 1; i >= 0; i--) {
                var rating = ratings[i];
                if (rating.createdAt < since) {
                    break;
                }
                result.push(rating);
            }
            return result;
        },

        withdraw: function (amount) {
            _transferNas(this.author, amount);
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
                    throw new Error('OUT_OF_ORDER:' + blockId + ':' + order._id);
                }
            });

            // unlock sold blocks in sell order
            var _this = this;
            if (order.direction === SELL) {
                blocks.forEach(function(blockId){
                    _this.orderLocks.del(blockId);
                });
            }

            blocksInOrder = blocksInOrder.filter(function(blockId){
                return blocksInOrderStatus[blockId];
            });
            if (blocksInOrder.length > 0) {
                order.blocks = stringifyBlocks(blocksInOrder);
                this.orders.set(order._id, order);
            } else {
                this.orders.del(order._id);
            }
        },
    
        _ensureBlocksInDistricts: function (districtIds, blocks) {
            var _this = this;
            var hit = false;
            blocks.forEach(function (blockId) {
                if (!districtIds[_this.blocks[blockId]]) {
                    throw new Error('BLOCK_NOT_IN_DISTRICT:' + blockId + JSON.stringify(districtIds));
                }
            });
        },

        _getDistrictById: function (districtId) {
            return this.districts.get(this.districtIds.get(districtId));
        },

        _getOrCreateDistrict: function(districtName) {
            var district = this.districts.get(districtName);
            if (!district) {
                return this._addDistrict(districtName);
            }
            return district;
        },
    
        _addDistrict: function (districtName, data) {
            var districtId = this.nextDistrictId++;
            var district = {};
            district._id = districtId;
            this.districtIds.set(districtId, districtName);
            this.districts.set(districtName, district);
            var chunks = districtName.split(':');
            if (chunks.length > 1) {
                var mainName = chunks[0];
                var subName = chunks[1];
                var subs = this.subs.get(mainName) || {};
                subs[subName] = district._id;
                this.subs.set(mainName, subs);
            }
            return district;
        },

        _createOrder: function (newOrder) {
            var _this = this;
            // check duplication
            if (newOrder.direction === SELL) {
                parseBlocks(newOrder.blocks).forEach(function(blockId){
                    if (_this.orderLocks.get(blockId)) {
                        throw new Error('ORDER_LOCKED_BLOCK');
                    } else {
                        _this.orderLocks.set(blockId, true);
                    }
                });
            }
            newOrder._id = this.nextOrderId++;
            this.orders.set(newOrder._id, newOrder);
            return newOrder;
        },
    
        _configure: function(districtName, update) {
            var district = this.districts.get(districtName);
            if (!district) {
                throw new Error('OWN_NOTHING');
            }
            var config = this.config.get(district._id) || {};
    
            for (var k in update) {
                config[k] = update[k];
            }
    
            this.config.set(district._id, config);
        },
    
        _transferBlocks: function (from, to, blocks, withSubs) {
            var allBlocks = this.blocks;
            var fromDistrict = this._getOrCreateDistrict(from);
            var toDistrict = this._getOrCreateDistrict(to);

            var allowedDistricts = {};
            allowedDistricts[fromDistrict._id] = true;
            if (withSubs) {
                var subs = this.subs.get(from);
                for (var distName in subs) {
                    var distId = subs[distName];
                    allowedDistricts[distId] = true;
                }
            }

            this._ensureBlocksInDistricts(allowedDistricts, blocks);
    
            blocks.forEach(function (blockId) {
                allBlocks[blockId] = toDistrict._id;
            });
            this.blocks = allBlocks;
        }
    }
    return BlocksContract;

    function _districtFullName(account, districtName) {
        return districtName ? account + ':' + districtName : account;
    }

    function _transferNas(to, amount) {
        Blockchain.transfer(to, amount);
        Event.Trigger("Blocks", {
            Transfer: {
                from: Blockchain.transaction.to,
                to: to,
                value: amount.toString()
            }
        });
    }
})();
