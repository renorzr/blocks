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
    
    var BlocksContract = function () {
        LocalContractStorage.defineProperties(this, {
            author: null,
            nextOwnerId: null,
            blocks: null
        });
    
        LocalContractStorage.defineMapProperties(this, {
            owners: null,
            ownerIds: null,
            balance: {
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
            var ownerId = this._addOwner(this.author).id;
            this._configure(this.author, IMG, HREF, HINT);
            this.blocks = Array(TOTAL_BLOCKS).fill(ownerId);
        },
    
        get: function () {
            return {
                blocks: this.blocks,
                owners: this.owners.filter(function(owner){ return owner.assets })
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
                throw new Exception('nothing to sell.');
            }
    
            _checkOwnership(owner.id, rect);
    
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
                throw new Exception(seller + ' is not selling anything.');
            }
    
            var blockCount = this._blockCount(rect); 
            var limit = owner.selling.limit;
            if (blockCount < limit[0] || blockCount > limit[1]) {
                throw new Exception('blockCount is not in range [' + limit[0] + ', ' + limit[1] + ']');
            }
    
            var buyer = Blockchain.transaction.from;
            if (owner.selling.to && buyer !== owner.selling.to) {
                throw new Exception('this is private trade');
            }
    
            var buyerBalance = Blockchain.transaction.value.plus(this.balance.get(buyer));
            var totalPrice = BigNumber(owner.selling.price).multipliedBy(blockCount);
            var fee = totalPrice.mutipliedBy(FEE);
            if (fee.lt(LEAST_FEE)) {
                fee = BigNumber(LEAST_FEE);
            }
            var totalPay = totalPrice.plus(fee);
            if (buyerBalance.lt(totalPay)) {
                throw new Exception('not enough money');
            }
    
            this.balance.set(buyer, buyerBalance.minus(totalPay));
    
            var sellerBalance = this.balance.get(seller);
            this.balance.set(seller, sellerBalance.plus(totalPrice));
    
            var authorBalance = this.balance.get(this.author);
            this.balance.set(this.author, authorBalance.plus(fee));
    
            this._transfer(seller, buyer, rect);
        },
    
        /**
         * deposit
         * amount: amount of money
         */
        deposit: function() {
            var from = Blockchain.transaction.from;
            var balance = this._balance(from).plus(Blockchain.transaction.value);
            this.balance.set(from, balance);
        },
    
        /**
         * withdraw
         * value: amount of money
         */
        withdraw: function(value) {
            var from = Blockchain.transaction.from;
            var amount = BigNumber(value);
            var balance = this._balance(from);
            if (amount.lt(0) || amount.gt(balance)) {
                throw new Exception("Insufficient balance");
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
            this.balance.set(from, balance.sub(amount));
        },
    
        configure: function(account, img, href, hint) {
            this._configure(Blockchain.transaction.from, img, href, hint);
        },
    
        _balance: function(account) {
            return this.balance.get(account) || BigNumber(0);
        },
    
        _blockCount: function(rect) {
            return Math.abs(rect[1] - rect[3] + 1) * Math.abs(rect[2] - rect[0] + 1);
        },
    
        _checkOwnership: function (ownerId, rect) {
            for (var y = rect[0]; y <= rect[2]; y++) { // top to bottom
                for (var x = rect[3]; x <= rect[1]; x++) { // left to right
                    var i = y * WIDTH + x;
                    if (this.blocks[i] !== ownerId) {
                        throw new Exception('block (' + x + ', ' + y + ') is not owned by the specified account.');
                    }
                }
            }
        },
    
        _getOwnerById: function (ownerId) {
            return this.owners.get(this.ownerIds.get(ownerId));
        },
    
        _addOwner: function (account) {
            var ownerId = this.nextOwnerId++
            var owner = {id: ownerId, assets: 0}
            this.ownerIds.set(ownerId, account);
            this.owners.set(account, owner);
            return owner;
        },
    
        _configure: function(account, img, href, hint) {
            var owner = this.owners.get(account);
            if (!owner) {
                throw new Exception(account + ' is not an owner');
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
                toOwner = _addOwner(to);
            }
    
            for (var y = rect[0]; y <= rect[2]; y++) { // top to bottom
                for (var x = rect[3]; x <= rect[1]; x++) { // left to right
                    var i = y * WIDTH + x;
                    if (blocks[i] !== fromOwner.id) {
                        throw new Exception('block (' + x + ', ' + y + ') is not owned by ' + from);
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
