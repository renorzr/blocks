"use strict"

module.exports = (function () {
    var IMG = 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png';
    var ZERO = 'AAA';
    var HREF = 'https://www.google.com/';
    var HINT = 'for sale';
    var WIDTH = 100;
    var HEIGHT = 100;
    var TOTAL_BLOCKS = WIDTH * HEIGHT;
    var FEE_RATE = new BigNumber("0.01");
    var FEE_LEAST = new BigNumber("0.05");
    var CHAR_CODE_OF_A = 65;
    var BASE = 26;
    
    var BlocksContract = function () {
        LocalContractStorage.defineProperties(this, {
            author: null,
            nextOwnerId: null,
            blocks: null,
            orders: null
        });
    
        LocalContractStorage.defineMapProperties(this, {
            owners: null,
            ownerIds: null,
        });
    }
    
    BlocksContract.prototype = {
        init: function () {
            this.nextOwnerId = 0;
            this.author = Blockchain.transaction.from;
            var owner = this._addOwner(this.author, {assets: TOTAL_BLOCKS});
            this._configure(this.author, IMG, ZERO, HREF, HINT);
            this.blocks = Array(TOTAL_BLOCKS).fill(owner.id);
            this.orders = [];
            owner.assets = TOTAL_BLOCKS;
        },
    
        get: function () {
            console.log('owners=', this.owners);
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
    
        /**
         * sell
         * price: price per block
         * blocks: blocks to sell
         * limit: limit of blockCount of blocks for 1 trade. format: [min, max]
         * to: only sell to specified account, null for no limit
         */
        sell: function (price, blocks, limit, to) {
            var from = Blockchain.transaction.from;
            var owner = this.owners.get(from);
            if (!(owner && owner.assets)) {
                throw new Error('nothing to sell.');
            }
    
            this._checkOwnership(owner.id, this._parseBlocks(blocks));
    
            owner.selling = {
                price: price,
                blocks: blocks,
                limit: limit,
                to: to
            }
            this.owners.set(from, owner);
        },
    
        /**
         * buy from a specified seller
         * seller: seller account
         * blocks: blocks to buy
         */
        buy: function (sellerId, blocks) {
            var seller = this.ownerIds.get(sellerId);
            var owner = this.owners.get(seller);
            if (!(owner && owner.selling)) {
                throw new Error('user ' + sellerId + ' is not selling anything.');
            }
    
            blocks = this._parseBlocks(blocks);
            var blockCount = blocks.length;
            var limit = owner.selling.limit;
            if (blockCount < limit[0] || blockCount > limit[1]) {
                throw new Error('blockCount is not in range [' + limit[0] + ', ' + limit[1] + ']');
            }
    
            var buyer = Blockchain.transaction.from;
            if (owner.selling.to && buyer !== owner.selling.to) {
                throw new Error('this is private trade');
            }
    
            var buyerPaying = Blockchain.transaction.value;
            var totalPrice = (new BigNumber(owner.selling.price)).mul(blockCount);
            var fee = totalPrice.mul(FEE_RATE);
            if (fee.lt(FEE_LEAST)) {
                fee = new BigNumber(FEE_LEAST);
            }
            var totalPay = totalPrice.plus(fee);
            if (buyerPaying.lt(totalPay)) {
                throw new Error('not enough money');
            }
    
            var overpay = buyerPaying.minus(totalPay);

            // transfer money
            this._transferNas(buyer, overpay);
            this._transferNas(seller, totalPrice);
            this._transferNas(this.author, fee);

            // transfer blocks from seller to buyer
            this._transferBlocks(seller, buyer, blocks);

            // remove sold blocks from selling.blocks
            var blocksForSaleStatus = {};
            var blocksForSale = this._parseBlocks(owner.selling.blocks);
            blocksForSale.forEach(function(blockId){
                blocksForSaleStatus[blockId] = true;
            });
            blocks.forEach(function(blockId){
                if (blocksForSaleStatus[blockId]) {
                    blocksForSaleStatus[blockId] = false;
                } else {
                    throw new Error('Block ' + blockId + ' is not for sale.');
                }
            });
            blocksForSale = blocksForSale.filter(function(blockId){
                return blocksForSaleStatus[blockId];
            });
            if (blocksForSale.length) {
                owner.selling.blocks = this._stringifyBlocks(blocksForSale);
            } else {
                owner.selling = null;
            }
            this.owners.set(seller, owner);
        },
    
        configure: function(img, offset, href, hint) {
            this._configure(Blockchain.transaction.from, img, offset, href, hint);
        },

        withdraw: function(amount) {
            _transferNas(this.author, new BigNumber(amount));
        }

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
                    throw new Error('block ' + blockId + ' is not owned by the specified account.');
                }
            });
        },

        _parseBlocks: function (blocks) {
            var result = [];
            for (var i = 0; i < blocks.length; i+=3) {
                var n = 0;
                var base = 1;
                for (var j = 0; j < 3; j++) {
                    var d = blocks.charCodeAt(i + j) - CHAR_CODE_OF_A;
                    n += d * base;
                    base *= BASE;
                }
                result.push(n);
            }
            return result;
        },

        _stringifyBlocks: function (blocks) {
           var result = '';
           blocks.forEach(function(blockId){
               var n = blockId;
               for (var i = 0; i < 3; i++) {
                   result += String.fromCharCode(n % BASE + CHAR_CODE_OF_A);
                   n = Math.floor(n / BASE);
               }
           });
           return result;
        },
    
        _getOwnerById: function (ownerId) {
            return this.owners.get(this.ownerIds.get(ownerId));
        },
    
        _addOwner: function (account, data) {
            var ownerId = this.nextOwnerId++;
            var owner = data || {assets: 0};
            owner.id = ownerId;
            this.ownerIds.set(ownerId, account);
            this.owners.set(account, owner);
            return owner;
        },
    
        _configure: function(account, img, offset, href, hint) {
            var owner = this.owners.get(account);
            if (!owner) {
                throw new Error(account + ' is not an owner');
            }
    
            owner.img = img;
            owner.offset = offset;
            owner.href = href;
            owner.hint = hint;
    
            this.owners.set(account, owner);
        },
    
       _transferBlocks: function (from, to, blocks) {
           var allBlocks = this.blocks;
           var fromOwner = this.owners.get(from);
           var toOwner = this.owners.get(to);
           if (!toOwner) {
               toOwner = this._addOwner(to);
           }
    
           blocks.forEach(function (blockId) {
               if (allBlocks[blockId] !== fromOwner.id) {
                   throw new Error('block ' + blockId + ' is not owned by the specified account.');
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
