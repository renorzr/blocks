var NebPay = require("nebpay");
var nebPay = new NebPay();
var CONTRACT_ADDRESS = "";

function buy(value) {
    nebPay.call(CONTRACT_ADDRESS, value, "buy", []);
}
