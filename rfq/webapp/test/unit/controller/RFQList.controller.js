/*global QUnit*/

sap.ui.define([
	"com/aisp/rfq/controller/RFQList.controller"
], function (Controller) {
	"use strict";

	QUnit.module("RFQList Controller");

	QUnit.test("I should test the RFQList controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
