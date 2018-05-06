"use strict"

module.exports = (function () {
    var IMG = 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png';
    var HREF = 'https://www.google.com/';
    var HINT = 'for sale';
    var WIDTH = 100;
    var HEIGHT = 100;
    var TOTAL_BLOCKS = WIDTH * HEIGHT;
    var FEE_RATE = 0.005
    var FEE_LEAST = 0.05
    var AUTHOR = 'n1drJMWfHCzLWR7wEbU9nVry1SGKUr4Gu9J';
    
    var BlocksContract = function () {
        LocalContractStorage.defineProperties(this, {
            author: null,
            nextOwnerId: null,
            blocks: null
        });
    
        LocalContractStorage.defineMapProperties(this, {
            owners: null,
            ownerIds: null,
            balances: {
                stringify: function (obj) {
                    return obj.toString();
                },
                parse: function (str) {
                    return new BigNumber(str);
                }
            }
        });
    }
    
    BlocksContract.prototype = {
        init: function () {
            this.nextOwnerId = 0;
            this.author = Blockchain.transaction.from;
            var owner = this._addOwner(this.author, {assets: TOTAL_BLOCKS});
            this._configure(this.author, IMG, HREF, HINT);
            this.blocks = Array(TOTAL_BLOCKS).fill(owner.id);
            owner.assets = TOTAL_BLOCKS;
            var v = new BigNumber(0.1);
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
                blocks: this.blocks,
                owners: owners
            }
        },
    
        /**
         * sell
         * price: price per block
         * rect: rect to sell, format: [top, right, bottom, left]
         * limit: limit of blockCount of blocks for 1 trade. format: [min, max]
         * to: only sell to specified account, null for no limit
         */
        sell: function (price, rect, limit, to) {
            var from = Blockchain.transaction.from;
            var owner = this.owners.get(from);
            if (!(owner && owner.assets)) {
                throw new Error('nothing to sell.');
            }
    
            this._checkOwnership(owner.id, rect);
    
            owner.selling = {
                price: price,
                rect: rect,
                limit: limit,
                to: to
            }
            this.owners.set(from, owner);
        },
    
        /**
         * buy from a specified seller
         * seller: seller account
         * rect: rect to buy, format: [top, right, bottom, left]
         */
        buy: function (seller, rect) {
            var owner = this.owners.get(seller)
            if (!(owner && owner.selling)) {
                throw new Error(seller + ' is not selling anything.');
            }
    
            var blockCount = this._blockCount(rect); 
            var limit = owner.selling.limit;
            if (blockCount < limit[0] || blockCount > limit[1]) {
                throw new Error('blockCount is not in range [' + limit[0] + ', ' + limit[1] + ']');
            }
    
            var buyer = Blockchain.transaction.from;
            if (owner.selling.to && buyer !== owner.selling.to) {
                throw new Error('this is private trade');
            }
    
            var buyerBalance = Blockchain.transaction.value.plus(this.balances.get(buyer) || 0);
            var totalPrice = (new BigNumber(owner.selling.price)).mul(blockCount);
            var fee = totalPrice.mul(FEE_RATE);
            if (fee.lt(FEE_LEAST)) {
                fee = new BigNumber(FEE_LEAST);
            }
            var totalPay = totalPrice.plus(fee);
            if (buyerBalance.lt(totalPay)) {
                throw new Error('not enough money');
            }
    
            this.balances.set(buyer, buyerBalance.minus(totalPay));
    
            var sellerBalance = this.balances.get(seller) || new BigNumber(0);
            this.balances.set(seller, sellerBalance.plus(totalPrice));
    
            var authorBalance = this.balances.get(this.author) || new BigNumber(0);
            this.balances.set(this.author, authorBalance.plus(fee));
    
            this._transfer(seller, buyer, rect);
        },

        /**
         * deposit
         */
        deposit: function() {
            var from = Blockchain.transaction.from;
            var balance = this._balance(from).plus(Blockchain.transaction.value);
            this.balances.set(from, balance);
        },
    
        /**
         * withdraw
         * value: amount of money
         */
        withdraw: function(value) {
            var from = Blockchain.transaction.from;
            var amount = new BigNumber(value);
            var balance = this._balance(from);
            if (amount.lt(0) || amount.gt(balance)) {
                throw new Error("Insufficient balance");
            }
            var result = Blockchain.transfer(from, amount);
            if (!result) {
                throw new Error("transfer failed.");
            }
            Event.Trigger("Blocks", {
                Transfer: {
                    from: Blockchain.transaction.to,
                    to: from,
                    value: amount.toString()
                }
            });
            this.balances.set(from, balance.sub(amount));
        },
    
        configure: function(img, href, hint) {
            this._configure(Blockchain.transaction.from, img, href, hint);
        },

        balance: function() {
            return this._balance(Blockchain.transaction.from);
        },
    
        _balance: function(account) {
            return this.balances.get(account) || new BigNumber(0);
        },
    
        _blockCount: function(rect) {
            return Math.abs(rect[1] - rect[3] + 1) * Math.abs(rect[2] - rect[0] + 1);
        },
    
        _checkOwnership: function (ownerId, rect) {
            for (var y = rect[0]; y <= rect[2]; y++) { // top to bottom
                for (var x = rect[3]; x <= rect[1]; x++) { // left to right
                    var i = y * WIDTH + x;
                    if (this.blocks[i] !== ownerId) {
                        throw new Error('block (' + x + ', ' + y + ') is not owned by the specified account.');
                    }
                }
            }
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
    
        _configure: function(account, img, href, hint) {
            var owner = this.owners.get(account);
            if (!owner) {
                throw new Error(account + ' is not an owner');
            }
    
            owner.img = img;
            owner.href = href;
            owner.hint = hint;
    
            this.owners.set(account, owner);
        },
    
       _transfer: function (from, to, rect) {
            var blocks = this.blocks;
            var fromOwner = this.owners.get(from);
            var toOwner = this.owners.get(to);
            if (!toOwner) {
                toOwner = this._addOwner(to);
            }
    
            for (var y = rect[0]; y <= rect[2]; y++) { // top to bottom
                for (var x = rect[3]; x <= rect[1]; x++) { // left to right
                    var i = y * WIDTH + x;
                    if (blocks[i] !== fromOwner.id) {
                        throw new Error('block (' + x + ', ' + y + ') is not owned by ' + from);
                    }
                    blocks[i] = toOwner.id;
                }
            }
            this.blocks = blocks;
            var blockCount = this._blockCount(rect);
            fromOwner.assets -= blockCount;
            toOwner.assets += blockCount;
            this.owners.set(from, fromOwner);
            this.owners.set(to, toOwner);
       }
    }
    return BlocksContract;
})();
