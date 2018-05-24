var MONTH = 30 * 24 * 3600 * 1000;
var MODE_NORMAL = 0;
var MODE_TRADE = 1;
var MODE_SETUP = 2;
var BK_SIZE = 10; // block size in pixels
var CANVAS_SIZE = BK_SIZE * EDGE_BLOCK_NUM;
var blocksApp = angular.module('blocksApp', ['ngRoute']);
var CONTRACT_ADDRESS = 'n1zq8XuGi58fTaLxvgCmsvpGwRtVD21kE3x';
var AUTHOR_ADDRESS = "n1drJMWfHCzLWR7wEbU9nVry1SGKUr4Gu9J";
var RENDER_DURATION = 100;
var FEE_RATE = 0.03;
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

blocksApp.controller('homeController', function($scope, $http, $location) {
    $('#card').hide();
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
    $scope.changedSettings = {};
    $scope.net = $location.host().indexOf('testnet') != -1 ? 'testnet' : 'mainnet';
    $scope.callUrl = 'https://' + $scope.net + '.nebulas.io/v1/user/call';

    $scope.$on('$viewContentLoaded', function(){
        window.postMessage({
            "target": "contentscript",
            "data":{
            },
            "method": "getAccount",
        }, "*");

        $scope.canvasPos = getPos($scope.canvas);

        $scope.call("get", function(data) {
            $scope.overallData = data;
            for (var districtId in data.districts) {
                var district = data.districts[districtId];
                district.loading = true;
                district.load = (function (district) {
                    function loadDistrictImage(district) {
                        console.log('loadDistrictImage', district);
                        var img = new Image();
                        img.src = district.config.img;
                        district.img = img;
                        img.onload = (function (district) {
                            return function () {
                                district.loaded = true;
                                district.loading = false;
                            }
                        })(district);
                        var offsetBlock = district.config.offset ? parseBlocks(district.config.offset)[0] : 0;
                        var pos = blockPos(offsetBlock);
                        district.offsetX = pos.x;
                        district.offsetY = pos.y;
                    }
                    return function () {
                        district.loaded = false;
                        district.loading = true;
                        if (district.config && district.config.img) {
                            console.log('config', district);
                            loadDistrictImage(district);
                        } else {
                            $scope.call("getConfig", district._id, function(data){
                                district.config = data || {};
                                if (district.config.img) {
                                    loadDistrictImage(district);
                                } else {
                                    district.loading = false;
                                }
                            });
                        }
                    };
                })(district);
            }
            render($scope.ctx, $scope.overallData);
        });

        $scope.call("market", function(market){
            $scope.orders = market.orders;
        });
    });

    $scope.call = function (method) {
        var args = Array.prototype.slice.call(arguments, 1);
        var cb = args.pop();
        var request = {
            from: $scope.account || AUTHOR_ADDRESS,
            to: CONTRACT_ADDRESS,
            value: "0",
            nonce: 0,
            gasPrice: "1000000",
            gasLimit: "200000",
            contract:{
                function: method,
                args: JSON.stringify(args)
            }
        };
        $http.post($scope.callUrl, JSON.stringify(request)).then(function(r){
            cb(JSON.parse(r.data.result.result));
        });
    }

    $scope.loadCard = function (e) {
        var currentBlock = getBlockByPos(e.offsetX, e.offsetY);
        $scope.showCard(currentBlock)
    }

    $scope.loadHref = function(e) {
        var currentBlock = getBlockByPos(e.offsetX, e.offsetY);
        if ($scope.lastBlock !== currentBlock) {
            $scope.lastBlock = currentBlock;
            var data = $scope.overallData;
            var district = $scope.getDistrictOfBlock(currentBlock);
            if (district) {
                var href = district.href;
                var title = district.title;
                if (href) {
                    $('#mainLink').attr("href", href);
                    $('#mainLink').attr("title", title);
                } else {
                    $('#mainLink').attr("href", "");
                    $('#mainLink').attr("title", title);
                }
            }
        }
    }

    $scope.mousedown = function(e) {
        $scope.drag = {
            startX: e.offsetX, startY: e.offsetY,
            x: e.offsetX, y: e.offsetY,
            dX: 0, dY: 0
        };
        $scope.updateLastBlock(e.offsetX, e.offsetY);
    }

    $scope.mousemove = function(e) {
        if ($scope.drag) {
            var drag = $scope.drag;
            drag.x = e.offsetX;
            drag.y = e.offsetY;
            drag.dX = drag.x - drag.startX;
            drag.dY = drag.y - drag.startY;
            $scope.updateLastBlock(e.offsetX, e.offsetY);
            $scope.invalidate();
        }
    }

    $scope.mouseup = function(e) {
        if ($scope.newImage) {
            $scope.newImageX += $scope.drag.dX;
            $scope.newImageY += $scope.drag.dY;
        }
        if ($scope.selectable) {
            $scope.selectRectBlocks();
        }
        $scope.updateSelectedBlocks();
        $scope.drag = null;
        $scope.invalidate();
        $scope.$apply();
    }

    $scope.updateSelectedBlocks = function () {
        if ($scope.selectable) {
            $scope.selectedBlocks = [];
            for (var blockId in $scope.blockStatus) {
                if ($scope.blockStatus[blockId].selected) {
                    $scope.selectedBlocks.push(blockId);
                }
            }
        }
    }

    $scope.updateLastBlock = function (x, y) {
        var currentBlock = getBlockByPos(x, y);
        if ($scope.lastBlock !== currentBlock) {
            $scope.lastBlock = currentBlock;
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
        var drag = $scope.drag;
        var left = Math.min(drag.x, drag.startX);
        var right = Math.max(drag.x, drag.startX);
        var top = Math.min(drag.y, drag.startY);
        var bottom = Math.max(drag.y, drag.startY);
        var startCol = Math.floor(left / BK_SIZE);
        var startRow = Math.floor(top / BK_SIZE);
        var endCol = Math.floor(right / BK_SIZE);
        var endRow = Math.floor(bottom / BK_SIZE);
        for (var col = startCol; col <= endCol; col++) {
            for (var row = startRow; row <= endRow; row++) {
                var blockId = Math.round(row * EDGE_BLOCK_NUM + col);
                var blockStatus = $scope.blockStatus[blockId];
                if (blockStatus.selectable) {
                    blockStatus.selected = true;
                }
            }
        }
    }

    $scope.startTrade = function (orderId) {
        console.log('start trade', orderId);
        $scope.resetTradeBlocks();
        $scope.mode = MODE_TRADE;
        $scope.tradingOrder = $scope.getOrderById(orderId);
        $scope.selectable = $scope.tradingOrder.creator != $scope.mainDistrictId;
        parseBlocks($scope.tradingOrder.blocks).forEach(function(blockId){
            $scope.blockStatus[blockId].selectable = true;
        });
        $scope.selectNone();
    }

    $scope.getOrderById = function (orderId) {
        for (var i in $scope.orders) {
            var order = $scope.orders[i];
            if (order && order._id === orderId) {
                return order;
            }
        }
        return null;
    }

    $scope.exitTrade = function () {
        $scope.restoreDistrict();
        $scope.resetTradeBlocks();
    }

    $scope.resetTradeBlocks = function () {
        $scope.mode = MODE_NORMAL;
        $scope.tradingOrder = null;
        $scope.newImage = $scope.newImageX = $scope.newImageY = null;
        for (var blockId in $scope.blockStatus) {
            $scope.blockStatus[blockId] = {};
        }
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
        return $scope.selectedBlocks && $scope.selectedBlocks.length * $scope.orderPrice;
    }

    $scope.setLink = function () {
        $('#linkModal').modal();
        var district = $scope.getCurrentDistrict();
        $scope.linkSettings = district.config;
        console.log($scope.linkSettings);
    }

    $scope.saveLinkSettings = function () {
        var district = $scope.getCurrentDistrict();
        district.config.href = $scope.changedSettings.href = $scope.linkSettings.href;
        district.config.title = $scope.changedSettings.title = $scope.linkSettings.title;
        $('#linkModal').modal('hide');
    }


    $scope.trade = function () {
        var order = $scope.tradingOrder;
        var nebpay = new NebPay();
        var blocks = stringifyBlocks($scope.selectedBlocks);
        var pay = order.direction ? $scope.pay : 0;
        var args = JSON.stringify([order.direction, order._id, blocks]);
        nebpay.call(CONTRACT_ADDRESS, pay.toFixed(5), "trade", args, { listener: txCallback(scope) });
    }

    $scope.startOrder = function (direction) {
        $scope.resetTradeBlocks();
        $scope.orderDirection = direction;
        var sell = direction;
        $scope.mode = MODE_TRADE;
        $scope.tradingOrder = null;
        $scope.selectable = true;
        var blocks = $scope.overallData.blocks;
        for (var blockId in blocks) {
            var districtId = blocks[blockId];
            var isMine = $scope.isMyBlock(districtId);
            $scope.blockStatus[blockId].selectable = (sell && isMine) || (!sell && !isMine);
        };
        $scope.selectNone();
    }

    $scope.validOrderPrice = function () {
        return $scope.orderPrice >= LOWEST_PRICE;
    }

    $scope.isMyBlock = function (districtId) {
        return $scope.districts.hasOwnProperty(districtId);
    }

    $scope.cancelOrder = function () {
        var nebpay = new NebPay();
        var args = JSON.stringify([$scope.tradingOrder._id]);
        nebpay.call(CONTRACT_ADDRESS, 0, "cancel", args, { listener: txCallback(scope) });
    }

    getBlockByPos = function (x, y) {
        var col = Math.floor(x / BK_SIZE);
        var row = Math.floor(y / BK_SIZE);
        return row * EDGE_BLOCK_NUM + col;
    }

    $scope.invalidate = function() {
        var drag = $scope.drag;
        var ctx = $scope.ctxTop;
        $scope.clear();
        ctx.globalAlpha = 1;
        if ($scope.newImage) {
            var img = $scope.newImage;
            var x = $scope.newImageX;
            var y = $scope.newImageY;
            if (drag) {
                x += drag.dX;
                y += drag.dY;
            }
            ctx.drawImage(img, x, y);
        }
        ctx.globalAlpha = 0.7;
        for (var blockId in $scope.blockStatus) {
            var pos = blockPos(blockId);
            var x = pos.x;
            var y = pos.y;
            var blockStatus = $scope.blockStatus[blockId];
            ctx.strokeStyle = "#a0a0a0";
            ctx.strokeRect(x, y, BK_SIZE, BK_SIZE);
            if (!blockStatus.highlight) {
                ctx.strokeStyle = "#000000";
                ctx.fillStyle = "#a0a0a0";
                ctx.fillRect(x, y, BK_SIZE, BK_SIZE);
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
        if ($scope.selectable && drag) {
            ctx.strokeRect(drag.startX, drag.startY, drag.dX, drag.dY);
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
        var value = $scope.orderDirection ? 0 : $scope.orderTotalPrice().toFixed(5);
        callContract(value, "order", $scope.orderDirection, parseFloat($scope.orderPrice), blocks, limit);
    }

    $scope.onNebMessage = function (data) {
        if (data.account) {
            console.log('account', data.account);
            $scope.account = data.account;
            $scope.call("mine", function(data) {
                console.log('data=', data);
                $scope.currentDistrictId = $scope.mainDistrictId = data._id;
                $scope.subs = data._subs;
                $scope.districts = {};
                $scope.districts[data._id] = null;
                for (var name in data._subs) {
                    $scope.districts[data._subs[name]] = name;
                }
                $scope.mineLoaded = true;
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

    $scope.changeDistrict = function (distId) {
        $scope.currentDistrictId = parseInt(distId);
        $scope.setup();
    }

    $scope.closeTxModal = function () {
        window.location.reload();
    }

    $scope.setup = function () {
        $scope.backupDistrict();
        $scope.resetTradeBlocks();
        $scope.mode = MODE_SETUP;
        $scope.transferringBlocks = false;
        $scope.selectable = false;
        var blocks = $scope.overallData.blocks;
        for (var blockId in blocks) {
            var districtId = blocks[blockId];
            var isCurrentDistrict = districtId === $scope.currentDistrictId;
            $scope.blockStatus[blockId].highlight = isCurrentDistrict;
        };
        $scope.selectNone();
    }

    $scope.startTransferBlocks = function () {
        $scope.transferringBlocks = true;
        $scope.selectable = true;
        var blocks = $scope.overallData.blocks;
        for (var blockId in blocks) {
            var districtId = blocks[blockId];
            var isCurrentDistrict = districtId === $scope.currentDistrictId;
            $scope.blockStatus[blockId].selectable = isCurrentDistrict;
        };
        $scope.selectNone();
    }

    $scope.transferBlocks = function (districtName) {
        var blocks = stringifyBlocks($scope.selectedBlocks);
        callContract(0, "transferBlocks",
            $scope.districts[$scope.currentDistrictId], districtName, blocks);
    }

    $scope.transferBlocksToNewDistrict = function () {
        var districtName = prompt("子区域名称");
        if (districtName) {
            return $scope.transferBlocks(districtName);
        }
    }

    $scope.addPic = function () {
        $('#image-input').click();
        $('#image-input').change(function() {loadImg($scope)});
    }

    $scope.getCurrentDistrict = function() {
        return $scope.overallData.districts[$scope.currentDistrictId];
    }

    $scope.assembleImage = function () {
        if ($scope.newImage) {
            var district = $scope.getCurrentDistrict();
            var img = $scope.newImage;
            var blocks = $scope.overallData.blocks;
            var leftMostCol = EDGE_BLOCK_NUM;
            var rightMostCol = 0;
            var topMostRow = EDGE_BLOCK_NUM;
            var bottomMostRow = 0;

            // find out bounding rect
            for (var blockId in blocks) {
                var districtId = blocks[blockId];
                if (districtId === $scope.currentDistrictId) {
                    var row = Math.floor(blockId / EDGE_BLOCK_NUM);
                    var col = blockId % EDGE_BLOCK_NUM;
                    leftMostCol = Math.min(leftMostCol, col);
                    rightMostCol = Math.max(rightMostCol, col);
                    topMostRow = Math.min(topMostRow, row);
                    bottomMostRow = Math.max(bottomMostRow, row);
                }
            }

            var leftMost = leftMostCol * BK_SIZE;
            var topMost = topMostRow * BK_SIZE;
            var assembleCanvas = document.getElementById('assemble');
            assembleCanvas.width = (rightMostCol - leftMostCol + 1) * BK_SIZE;
            assembleCanvas.height = (bottomMostRow - topMostRow + 1) * BK_SIZE;
            var ctx = assembleCanvas.getContext('2d');

            // render to assembleCanvas
            for (var blockId in blocks) {
                var districtId = blocks[blockId];
                if (districtId === $scope.currentDistrictId) {
                    var districtId = blocks[blockId];
                    var pos = blockPos(blockId);
                    var x = pos.x;
                    var y = pos.y;
                    var clipX = Math.round(x - $scope.newImageX);
                    var clipY = Math.round(y - $scope.newImageY);
                    if (clipX > -BK_SIZE && clipY > -BK_SIZE && clipX < img.width && clipY < img.height) {
                        ctx.drawImage(img, clipX, clipY, BK_SIZE, BK_SIZE, x - leftMost, y - topMost, BK_SIZE, BK_SIZE);
                    } else {
                        renderBlock(ctx, district, blockId, -leftMost, -topMost);
                    }
                }
            }
            var blockOffset = topMostRow * EDGE_BLOCK_NUM + leftMostCol;
            if (!district.config) district.config = {};
            district.config.offset = stringifyBlocks([blockOffset]);
            district.config.img = assembleCanvas.toDataURL('image/webp');
            $scope.changedSettings.img = district.config.img;
            $scope.changedSettings.offset = district.config.offset;

            district.loaded = false;
            district.loading = true;
            $scope.newImage = null;
            render($scope.ctx, $scope.overallData);
            $scope.invalidate();
        }
    }

    $scope.cancelAddPic = function() {
        $scope.newImage = null;
        $scope.invalidate();
    }

    $scope.save = function () {
        callContract(0, "configure", $scope.districts[$scope.currentDistrictId], $scope.changedSettings);
    }

    $scope.backupDistrict = function () {
        $scope.districtBackup = $.extend({}, $scope.getCurrentDistrict());
    }

    $scope.restoreDistrict = function () {
        if ($scope.districtBackup) {
            $scope.overallData.districts[$scope.currentDistrictId] = $scope.districtBackup;
        }
    }

    $scope.showCard = function (blockId) {
        $scope.showingDistrict = $scope.getDistrictOfBlock(blockId);
        if (!$scope.showingDistrict) return;
        console.log('showing', $scope.showingDistrict);
        var pos = blockPos(blockId);
        var card = $('#card');
        var width = card.width();
        var height = card.height();
        var canvasPos = getPos($scope.canvas);
        var x = pos.x - width / 2;
        var y = pos.y - height / 2;
        if (x < 0) x = 0;
        if (x > CANVAS_SIZE - width) x = CANVAS_SIZE - width;
        if (y < 0) y = 0;
        if (y > CANVAS_SIZE - height) y = CANVAS_SIZE - height;
        card.hide().css('left', canvasPos[0] + x).css('top', canvasPos[1] + y).show();
        $scope.$apply();
        $scope.loadRatings($scope.showingDistrict._id);
    }

    $scope.loadRatings = function (districtId) {
        $scope.loadingRatings = true;
        $scope.call("ratings", districtId, Date.now() - MONTH, function (ratings) {
            var district = $scope.overallData.districts[districtId]
            district.ratings = ratings;
            var sum = 0;
            for (var i in ratings) {
                sum += parseInt(ratings[i].rating);
            }
            console.log('loadRatings', ratings.length, sum);
            $scope.rate = ratings.length < 10 ? 0 : Math.floor(sum / ratings.length);
            $scope.loadingRatings = false;
        });
    }

    $scope.closeCard = function () {
        $('#card').hide();
    }

    $scope.startRating = function () {
        $scope.toDonate = false;
        $scope.currentRate = 0;
        $scope.comment = null;
        $('#ratingModal').modal();
    }

    $scope.rating = function () {
        callContract(
            $scope.toDonate ? 0.1 : 0,
            "rating",
            $scope.showingDistrict._id,
            $scope.currentRate,
            $scope.comment
        );
    }

    $scope.getDistrictOfBlock = function (blockId) {
        var data = $scope.overallData;
        return data && data.districts[data.blocks[blockId]];
    }

    $scope.short = function (account) {
        return account.substring(0, 4) + "..." + account.substring(account.length - 4);
    }
});

blocksApp.controller('aboutController', function($scope) {
});

blocksApp.controller('assetsController', function($scope) {
});

function callContract(value, method) {
    var args = Array.prototype.slice.call(arguments, 2);
    var nebpay = new NebPay();
    nebpay.call(CONTRACT_ADDRESS, value, method, JSON.stringify(args), { listener: txCallback(scope) });
}

function render(ctx, data) {
    for (var districtId in data.districts) {
        var district = data.districts[districtId];
        district.load();
    }
    for (var i = 0; i < data.blocks.length; i++) {
        var districtId = data.blocks[i];
        var district = data.districts[districtId];
        renderOnLoad(ctx, district, i);
    }
}

function renderOnLoad(ctx, district, blockId) {
    if (district.loaded) {
        renderBlock(ctx, district, blockId);
    } else if (district.loading) {
        setTimeout(function(){renderOnLoad(ctx, district, blockId)}, Math.random() * RENDER_DURATION);
    }
}

function renderBlock(ctx, district, blockId, offsetX, offsetY) {
    if (!offsetX) offsetX = 0;
    if (!offsetY) offsetY = 0;
    var img = district.img;
    var pos = blockPos(blockId);
    var clipX = Math.round(pos.x - district.offsetX);
    var clipY = Math.round(pos.y - district.offsetY);
    if (clipX > -BK_SIZE && clipY > -BK_SIZE && clipX < img.width && clipY < img.height) {
        ctx.drawImage(img, clipX, clipY, BK_SIZE, BK_SIZE, pos.x + offsetX, pos.y + offsetY, BK_SIZE, BK_SIZE);
    }
}

function blockPos(blockId) {
    var row = Math.floor(blockId / EDGE_BLOCK_NUM);
    var col = blockId % EDGE_BLOCK_NUM;
    return {
        row: row,
        col: col,
        x: Math.round(col * BK_SIZE),
        y: Math.round(row * BK_SIZE)
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
        var img = new Image();
        img.src = e.target.result;
        scope.newImageX = scope.newImageY = 0;
        scope.newImage = img;
        img.onload = function () {
            scope.invalidate();
            setTimeout(function(){scope.$apply();}, 10);
        }
    };

    reader.readAsDataURL(file);
}

$(window).scroll(function (e) {
    var toolbar = $('#toolbar');
    var isPositionFixed = (toolbar.css('position') == 'fixed');
    var scrollBottom = $(this).scrollTop() + window.innerHeight;
    if (!isPositionFixed) {
        var toolbarTop = getPos(toolbar[0])[1];
        if (scrollBottom < toolbarTop + toolbar.height() + 20) {
            toolbar.attr('originTop', toolbarTop);
            toolbar.css({'position': 'fixed', 'bottom': '20px'});
        }
    } else if (scrollBottom > parseInt(toolbar.attr('originTop')) + toolbar.height()) {
        toolbar.css({'position': '', 'bottom': ''});
    }
});

