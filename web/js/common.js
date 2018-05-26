var EDGE_BLOCK_NUM = 100; // how many blocks in one row (the same in one column)
var TOTAL_BLOCKS = EDGE_BLOCK_NUM * EDGE_BLOCK_NUM ;
var BUY = 0;
var SELL = 1;
var BASE = 26;
var CHAR_CODE_OF_A = 65;
var CHAR_CODE_OF_A_DOWNCASE = 97;
var LOWEST_PRICE = 0.1;


function parseBlocks(blocks) {
    var result = [];
    for (var i = 0; i < blocks.length; i+=3) {
        var n = 0;
        var base = 1;
        if (blocks[i] >= 'a' && blocks[i] <= 'z') {
            for (var j = 0; j < 3; j++) {
                var d = blocks.charCodeAt(i + j) - CHAR_CODE_OF_A_DOWNCASE;
                n += d * base;
                base *= BASE;
            }
            var last = result[result.length - 1];
            for (var r = 0; r < n; r++) {
                result.push(last + r + 1);
            }
        } else {
            for (var j = 0; j < 3; j++) {
                var d = blocks.charCodeAt(i + j) - CHAR_CODE_OF_A;
                n += d * base;
                base *= BASE;
            }
            result.push(n);
        }
    }
    return result;
}

function stringifyBlocks(blocks) {
    var result = '';
    var continous = 0;
    var last = null;
    var lastToWrite = null;

    blocks.push(-1);
    for (var blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        var blockId = blocks[blockIndex];
        var continousWrote = false;

        if (blockId - 1 == last) {
            continous += 1;
        } else {
            if (lastToWrite != null) {
                var n = lastToWrite;
                for (var i = 0; i < 3; i++) {
                    result += String.fromCharCode(n % BASE + CHAR_CODE_OF_A);
                    n = Math.floor(n / BASE);
                }
            }
            if (continous > 0) {
                var n = continous;
                for (var i = 0; i < 3; i++) {
                    result += String.fromCharCode(n % BASE + CHAR_CODE_OF_A_DOWNCASE);
                    n = Math.floor(n / BASE);
                }
            }
            continous = 0;
            lastToWrite = blockId;
        }

        last = blockId;
    }
    blocks.pop();

    return result;
}

/*
// test
A = [2,3,5,6,7,8,9,11,15];
s = stringifyBlocks(A);
console.log(s);
a = parseBlocks(s);
console.log(a);

for (var i in A) {
    if (A[i] !== a[i]) {
        throw new Error('parse errro');
    }
}
*/
