var MODE_NORMAL = 0;
var MODE_TRADE = 1;
var MODE_SETUP = 2;
var CHAR_CODE_OF_A = 'A'.charCodeAt();
var BASE = 26;
var BK_SIZE = 10; // block size in pixels
var ROW_BLOCK_NUM = 100; // how many blocks in one row (the same in one column)
var TOTAL_BLOCKS = ROW_BLOCK_NUM ** 2;
var blocksApp = angular.module('blocksApp', ['ngRoute']);
var BASE_URL = 'https://testnet.nebulas.io';
var CALL_URL = BASE_URL + '/v1/user/call';
var CONTRACT_ADDRESS = 'n222gn1FXgJMfBqsQMrCYgED8tKxDQxRnWq';
var GET_CALL = '{"from":"n1drJMWfHCzLWR7wEbU9nVry1SGKUr4Gu9J","to":"' + CONTRACT_ADDRESS + '","value":"0","nonce":0,"gasPrice":"1000000","gasLimit":"200000","contract":{"function":"get","args":"[]"}}';
var MARKET_CALL = '{"from":"n1drJMWfHCzLWR7wEbU9nVry1SGKUr4Gu9J","to":"' + CONTRACT_ADDRESS + '","value":"0","nonce":0,"gasPrice":"1000000","gasLimit":"200000","contract":{"function":"market","args":"[]"}}';
var RENDER_DURATION = 100;
var BUY = 0;
var FEE_RATE = 0.01;
var FEE_LEAST = 0.1;
var NebPay = require("nebpay");


blocksApp.config(function($routeProvider) {
    $routeProvider

        .when('/about', {
            templateUrl : 'pages/about.html',
            controller  : 'aboutController'
        })

        .when('/assets', {
            templateUrl : 'pages/assets.html',
            controller  : 'assetsController'
        })
        .otherwise({
            templateUrl : 'pages/home.html',
            controller  : 'homeController'
        })
    ;
});

blocksApp.controller('mainController', function($scope) {
});

blocksApp.controller('homeController', function($scope, $http) {
    window.scope = $scope;
    $scope.blockStatus = [];
    for (var i = 0; i < TOTAL_BLOCKS; i++) {
        $scope.blockStatus.push({});
    }
    $scope.mode = MODE_NORMAL;
    $scope.directions = [0,1];
    $scope.canvas = document.getElementById('canvas');
    $scope.canvasTop = document.getElementById('canvasTop');
    $scope.ctx = canvas.getContext('2d');
    $scope.ctxTop = canvasTop.getContext('2d');
    $scope.orderPrice = 0.1;

    $scope.$on('$viewContentLoaded', function(){
        window.postMessage({
            "target": "contentscript",
            "data":{
            },
            "method": "getAccount",
        }, "*");

        $scope.canvasPos = getPos($scope.canvas);

        $http.post(CALL_URL, GET_CALL).then(function(r){
            $scope.overallData = JSON.parse(r.data.result.result);
            render($scope.ctx, $scope.overallData);
        });

        $http.post(CALL_URL, MARKET_CALL).then(function(r){
            var orders = JSON.parse(r.data.result.result);
            $scope.orders = [];
            for (var orderId in orders) {
                var order = orders[orderId];
                order.blocks = parseBlocks(order.blocks);
                if (!order.limit) {
                    order.limit = [1, order.blocks.length];
                }
                $scope.orders.push(order);
            }
        });
    });

    $scope.mousedown = function(e) {
        if ($scope.selectable) {
            $scope.rect = {x: e.offsetX, y: e.offsetY, w: 0, h: 0};
            $scope.updateLastBlock(e.offsetX, e.offsetY, function(){$scope.selectRectBlocks()});
        } else if ($scope.newImage) {
            $scope.updateLastBlock(e.offsetX, e.offsetY, function(){$scope.relocateNewImage()});
        }
    }

    $scope.mousemove = function(e) {
        if ($scope.rect) {
            $scope.rect.w = e.offsetX - $scope.rect.x;
            $scope.rect.h = e.offsetY - $scope.rect.y;
            $scope.updateLastBlock(e.offsetX, e.offsetY, function(){$scope.selectRectBlocks()});
            $scope.invalidate();
        } else if ($scope.newImage) {
            $scope.updateLastBlock(e.offsetX, e.offsetY, function(){$scope.relocateNewImage()});
            $scope.invalidate();
        }
    }

    $scope.mouseup = function(e) {
        $scope.rect = null;
        $scope.invalidate();
        $scope.$apply();
    }

    $scope.updateLastBlock = function (x, y, callback) {
        var currentBlock = getBlockByPos(x, y);
        if ($scope.lastBlock !== currentBlock) {
            $scope.lastBlock = currentBlock;
            callback();
        }
    }

    $scope.selectNone = function () {
        for (var blockId in $scope.blockStatus) {
            $scope.blockStatus[blockId].selected = false;
        }
        $scope.selectedBlocks = [];
        $scope.invalidate();
    }

    $scope.selectRectBlocks = function () {
        var rect = $scope.rect;
        var left = Math.min(rect.x, rect.x + rect.w);
        var right = Math.max(rect.x, rect.x + rect.w);
        var top = Math.min(rect.y, rect.y + rect.h);
        var bottom = Math.max(rect.y, rect.y + rect.h);
        var startCol = Math.floor(left / BK_SIZE);
        var startRow = Math.floor(top / BK_SIZE);
        var endCol = Math.floor(right / BK_SIZE);
        var endRow = Math.floor(bottom / BK_SIZE);
        $scope.selectedBlocks = [];
        for (var col = startCol; col <= endCol; col++) {
            for (var row = startRow; row <= endRow; row++) {
                var blockId = Math.round(row * ROW_BLOCK_NUM + col);
                var blockStatus = $scope.blockStatus[blockId];
                if (blockStatus.selectable) {
                    blockStatus.selected = true;
                    $scope.selectedBlocks.push(blockId);
                }
            }
        }
    }

    $scope.relocateNewImage = function () {
    }

    $scope.startTrade = function (orderId) {
        console.log('start trade', orderId);
        $scope.mode = MODE_TRADE;
        $scope.tradingOrder = $scope.getOrderById(orderId);
        $scope.selectable = $scope.tradingOrder.creator != $scope.myOwnerId;
        $scope.blockStatus.forEach(function(blockStatus) {
            blockStatus.selectable = false;
        });
        $scope.tradingOrder.blocks.forEach(function(blockId){
            $scope.blockStatus[blockId].selectable = true;
        });
        $scope.selectNone();
    }

    $scope.getOrderById = function (orderId) {
        for (var i in $scope.orders) {
            var order = $scope.orders[i];
            if (order.id === orderId) {
                return order;
            }
        }
        return null;
    }

    $scope.exitTrade = function () {
        $scope.mode = MODE_NORMAL;
        $scope.tradingOrder = null;
    }

    $scope.confirmTrade = function () {
        var selectedBlockNum = $scope.selectedBlocks.length;
        var limit = $scope.tradingOrder.limit;
        console.log(selectedBlockNum, limit);
        if (selectedBlockNum < parseInt(limit[0]) || selectedBlockNum  > parseInt(limit[1])) {
            alert("本交易单限制交易格子数在" + limit.join(" - ") + "之间");
            return;
        }
        $('#tradeModal').modal();
        $scope.totalPrice = $scope.tradingOrder.price * $scope.selectedBlocks.length;
        $scope.fee = Math.max($scope.totalPrice * FEE_RATE, FEE_LEAST);
        if ($scope.tradingOrder.direction === BUY) {
            $scope.pay = $scope.totalPrice - $scope.fee;
        } else {
            $scope.pay = $scope.totalPrice + $scope.fee;
        }
    }

    $scope.orderTotalPrice = function () {
        return $scope.selectedBlocks.length * $scope.orderPrice;
    }

    $scope.trade = function () {
        var order = $scope.tradingOrder;
        var nebpay = new NebPay();
        var blocks = stringifyBlocks($scope.selectedBlocks);
        var pay = order.direction ? $scope.pay : 0;
        var args = JSON.stringify([order.direction, order.id, blocks]);
        nebpay.call(CONTRACT_ADDRESS, pay.toFixed(5), "trade", args, { listener: txCallback(scope) });
    }

    $scope.startOrder = function (direction) {
        $scope.orderDirection = direction;
        var sell = direction;
        $scope.mode = MODE_TRADE;
        $scope.tradingOrder = null;
        $scope.selectable = true;
        var blocks = $scope.overallData.blocks;
        for (var blockId in blocks) {
            var ownerId = blocks[blockId];
            var isMine = ownerId === $scope.myOwnerId;
            $scope.blockStatus[blockId].selectable = (sell && isMine) || (!sell && !isMine);
        };
        $scope.selectNone();
    }

    $scope.cancelOrder = function () {
        var nebpay = new NebPay();
        var args = JSON.stringify([$scope.tradingOrder.id]);
        nebpay.call(CONTRACT_ADDRESS, 0, "cancel", args, { listener: txCallback(scope) });
    }

    getBlockByPos = function (x, y) {
        var col = Math.floor(x / BK_SIZE);
        var row = Math.floor(y / BK_SIZE);
        return row * ROW_BLOCK_NUM + col;
    }

    $scope.invalidate = function() {
        var rect = $scope.rect;
        var ctx = $scope.ctxTop;
        $scope.clear();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#000000";
        ctx.fillStyle = "#a0a0a0";
        ctx.fillRect(0, 0, ROW_BLOCK_NUM * BK_SIZE, ROW_BLOCK_NUM * BK_SIZE);
        if (rect) {
            ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        }
        for (var blockId in $scope.blockStatus) {
            var row = Math.floor(blockId / ROW_BLOCK_NUM);
            var col = blockId % ROW_BLOCK_NUM;
            var x = Math.round(col * BK_SIZE);
            var y = Math.round(row * BK_SIZE);
            var blockStatus = $scope.blockStatus[blockId];
            ctx.strokeStyle = "#a0a0a0";
            ctx.strokeRect(x, y, BK_SIZE, BK_SIZE);
            if (blockStatus.highlight) {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(x, y, BK_SIZE, BK_SIZE);
                ctx.strokeStyle = "#ffffff";
                ctx.strokeRect(x, y, BK_SIZE, BK_SIZE);
            }
            if (blockStatus.selected) {
                ctx.fillStyle = "#0000ff";
                ctx.fillRect(x, y, BK_SIZE, BK_SIZE);
            }
            if (blockStatus.selectable) {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(x, y, BK_SIZE, BK_SIZE);
                ctx.strokeStyle = "#000000";
                ctx.strokeRect(x, y, BK_SIZE, BK_SIZE);
            }
        };
        if ($scope.newImage) {
            var img = $scope.newImage;
            ctx.drawImage(img, 0, 0);
        }
    }

    $scope.clear = function () {
        $scope.canvasTop.height = $scope.canvasTop.height;
    }

    $scope.confirmOrder = function () {
        $scope.minBlocks = $scope.maxBlocks = $scope.selectedBlocks.length;
        $('#orderModal').modal();
    }

    $scope.createOrder = function () {
        var blocks = stringifyBlocks($scope.selectedBlocks);
        var limit = [$scope.minBlocks, $scope.maxBlocks];
        var nebpay = new NebPay();
        var args = JSON.stringify([$scope.orderDirection, parseFloat($scope.orderPrice), blocks, limit]);
        var value = $scope.orderDirection ? 0 : $scope.orderTotalPrice().toFixed(5);
        nebpay.call(CONTRACT_ADDRESS, value, "order", args, { listener: txCallback(scope) });
    }

    $scope.onNebMessage = function (data) {
        if(data.account) {
            console.log('account', data.account);
            $scope.account = data.account;
            var mineCall = '{"from":"' + $scope.account + '","to":"' + CONTRACT_ADDRESS + '","value":"0","nonce":0,"gasPrice":"1000000","gasLimit":"200000","contract":{"function":"mine","args":"[]"}}';
            $http.post(CALL_URL, mineCall).then(function(r){
                var data = JSON.parse(r.data.result.result);
                $scope.myOwnerId = data.id;
            });
        }
        if(data.txhash) {
            console.log('txhash', data.txhash);
        }
        if(data.receipt) {
            console.log('receipt', data.receipt);
        }
        if(data.neb_call){
            console.log('neb_call', data.neb_call);
        }
    }

    $scope.closeTxModal = function () {
        window.location.reload();
    }

    $scope.setup = function () {
        $scope.mode = MODE_SETUP;
        $scope.selectable = false;
        var blocks = $scope.overallData.blocks;
        for (var blockId in blocks) {
            var ownerId = blocks[blockId];
            var isMine = ownerId === $scope.myOwnerId;
            $scope.blockStatus[blockId].highlight = isMine;
        };
        $scope.selectNone();
    }

    $scope.addPic = function () {
        $('#image-input').click();
        $('#image-input').change(function() {loadImg($scope)});
    }
});

blocksApp.controller('aboutController', function($scope) {
});

blocksApp.controller('assetsController', function($scope) {
});

function parseBlocks(blocks) {
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
}

function stringifyBlocks(blocks) {
   var result = '';
   blocks.forEach(function(blockId){
       var n = blockId;
       for (var i = 0; i < 3; i++) {
           result += String.fromCharCode(n % BASE + CHAR_CODE_OF_A);
           n = Math.floor(n / BASE);
       }
   });
   return result;
}

function render(ctx, data) {
    for (var ownerId in data.owners) {
        var owner = data.owners[ownerId];
        console.log('owner[' + ownerId + ']=', owner);
        if (!owner.img) continue;
        var img = new Image();
        img.src = owner.img;
        owner.img = img;
        var offsetBlock = owner.offset ? parseBlocks(owner.offset)[0] : 0;
        var offsetRow = Math.floor(offsetBlock / ROW_BLOCK_NUM);
        var offsetCol = offsetBlock % ROW_BLOCK_NUM;
        owner.offsetX = Math.round(offsetCol * BK_SIZE);
        owner.offsetY = Math.round(offsetRow * BK_SIZE);
        img.setAttribute('crossOrigin', 'anonymous');
        img.onload = (function(owner) {
            return function() {
                owner.loaded = true;
            }
        })(owner);
    }
    for (var i = 0; i < data.blocks.length; i++) {
        var ownerId = data.blocks[i];
        var owner = data.owners[ownerId];
        renderOnLoad(ctx, owner, i);
    }
}

function renderOnLoad(ctx, owner, blockId) {
    if (owner.loaded) {
        renderBlock(ctx, owner, blockId);
    } else {
        setTimeout(function(){renderOnLoad(ctx, owner, blockId)}, Math.random() * RENDER_DURATION);
    }
}

function renderOwner(ctx, owner) {
    owner.blocks.forEach(function(blockId) {
        setTimeout(function() {
            renderBlock(ctx, owner, blockId)
        }, 100 * Math.random());
    });
}

function renderBlock(ctx, owner, blockId) {
    var img = owner.img;
    var row = Math.floor(blockId / ROW_BLOCK_NUM);
    var col = blockId % ROW_BLOCK_NUM;
    var x = Math.round(col * BK_SIZE);
    var y = Math.round(row * BK_SIZE);
    var clipX = Math.round(x - owner.offsetX);
    var clipY = Math.round(y - owner.offsetY);
    if (clipX > -BK_SIZE && clipY > -BK_SIZE && clipX < img.width && clipY < img.height) {
        ctx.drawImage(img, clipX, clipY, BK_SIZE, BK_SIZE, x, y, BK_SIZE, BK_SIZE);
    }
}

function getPos(ele){
    var x=0;
    var y=0;
    while(true){
        x += ele.offsetLeft;
        y += ele.offsetTop;
        if(ele.offsetParent === null){
            break;
        }
        ele = ele.offsetParent;
    }
    return [x, y];
}

function txCallback(scope) {
    return function (data) {
        console.log('tx callback', data);
        $('.modal').modal('hide');
        scope.$apply(function () {scope.txhash = data.txhash});
        $('#txModal').modal();
    }
}

window.addEventListener('message', function(e) {
    if (e.data.data) scope.onNebMessage(e.data.data);
});

function loadImg(scope){
    var file = $("#image-input")[0].files[0];
    var reader = new FileReader();
    var imgFile;
    reader.onload=function(e) {
        var image = new Image();
        image.src = e.target.result;
        scope.newImage = image;
        image.onload = function () {
            scope.invalidate();
        }
    };

    reader.readAsDataURL(file);
}
