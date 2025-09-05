sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment",
  "sap/m/MessageToast",
  "sap/m/HBox",
  "sap/m/Avatar",
  "sap/m/MessageStrip"
], (BaseController, JSONModel, Fragment, MessageToast, HBox, Avatar, MessageStrip) => {
  "use strict";

  return BaseController.extend("com.aisp.rfq.controller.App", {
    onInit() {
      var oData = {
        "notifications": [
          {
            "id": "1",
            "title": "RFQ Approved Today",
            "description": "RFQ #700000096 approved at 01:00 PM IST today",
            "Author": "Admin1",
            "AuthorPicUrl": "sap-icon://person-placeholder",
            "Type": "Approval",
            "Date": "2025-08-22T13:00:00Z",
            "Text": "RFQ #700000096 has been approved",
            "Actions": [
              {
                "Text": "View Details",
                "Icon": "sap-icon://display",
                "Key": "view"
              }
            ]
          },
          {
            "id": "2",
            "title": "Deadline Tomorrow",
            "description": "RFQ #700000097 due by 5:00 PM IST on Aug 23, 2025",
            "Author": "Manager2",
            "AuthorPicUrl": "sap-icon://person-placeholder",
            "Type": "Reminder",
            "Date": "2025-08-22T13:41:00Z",
            "Text": "Submit your bid for RFQ #700000097",
            "Actions": [
              {
                "Text": "Submit Bid",
                "Icon": "sap-icon://edit",
                "Key": "submit"
              }
            ]
          },
          {
            "id": "3",
            "title": "Deadline Tomorrow",
            "description": "RFQ #700000097 due by 5:00 PM IST on Aug 23, 2025",
            "Author": "Manager2",
            "AuthorPicUrl": "sap-icon://person-placeholder",
            "Type": "Reminder",
            "Date": "2025-08-22T13:41:00Z",
            "Text": "Submit your bid for RFQ #700000097",
            "Actions": [
              {
                "Text": "Submit Bid",
                "Icon": "sap-icon://edit",
                "Key": "submit"
              }
            ]
          },
          {
            "id": "4",
            "title": "Deadline Tomorrow",
            "description": "RFQ #700000097 due by 5:00 PM IST on Aug 23, 2025",
            "Author": "Manager2",
            "AuthorPicUrl": "sap-icon://person-placeholder",
            "Type": "Reminder",
            "Date": "2025-08-22T13:41:00Z",
            "Text": "Submit your bid for RFQ #700000097",
            "Actions": [
              {
                "Text": "Submit Bid",
                "Icon": "sap-icon://edit",
                "Key": "submit"
              }
            ]
          }
        ]
      };

      this.getView().setModel(new JSONModel(oData), "oNotificationsModel");
      this._oPopover = null;

      // Initialize chat busy state
      this.getView().setModel(new JSONModel({
        chatBusy: false
      }), "oSubmitStateModel");
    },

    formatDateTime: function (dateTime) {
      if (!dateTime) return "";

      var oDate = new Date(dateTime);
      return sap.ui.core.format.DateFormat.getDateTimeInstance({
        pattern: "MMM dd, yyyy hh:mm a"
      }).format(oDate);
    },

    onNotificationPress: function (oEvent) {
      var oButton = oEvent.getSource(),
        oView = this.getView();

      if (!this._oPopover) {
        Fragment.load({
          id: oView.getId(),
          name: "com.aisp.rfq.fragments.Notification",
          controller: this
        }).then(function (oPopover) {
          oView.addDependent(oPopover);
          this._oPopover = oPopover;
          oPopover.setModel(this.getView().getModel("oSubmitStateModel"), "oSubmitStateModel");
          this._oPopover.openBy(oButton);
        }.bind(this));
      } else {
        this._oPopover.openBy(oButton);
      }
    },

    onNavToDetail: function (oEvent) {
      var oItem = oEvent.getSource();
      var oBindingContext = oItem.getBindingContext("oNotificationsModel");
      var sPath = oBindingContext.getPath();

      this.byId("navCon").to(this.byId("detail"));
      this.byId("detail").bindElement({
        path: sPath,
        model: "oNotificationsModel"
      });
    },

    onNavBack: function () {
      this.byId("navCon").back();
    },

    onActionPressed: function (oEvent) {
      var oItem = oEvent.getSource().getParent();
      var oNotification = oItem.getBindingContext("oNotificationsModel").getObject();
      var oNavCon = this.byId("navCon")
      var oDetailPage = this.byId("detail");
      oNavCon.to(oDetailPage);
    },

    handleCloseButton: function (oEvent) {
      if (this._oPopover) {
        this._oPopover.close();
      }
    },

    onSendMessage: function () {
      var sText = this.byId("idUserChatInput").getValue().trim();
      if (!sText) {
        MessageToast.show("Please enter a message.");
        return;
      }

      this.byId("idUserChatInput").setValue("");

      this.getView().getModel("oSubmitStateModel").setProperty("/chatBusy", true);

      var oMessagesBox = this.byId("idMessagesBox");

      // Add user message
      var oUserMessageHBox = new HBox({
        width: "100%",
        items: [
          new Avatar({
            displayShape: "Circle",
            displaySize: "XS",
            initials: "U"
          }),
          new MessageStrip({
            text: sText,
            showIcon: false,
          })
        ]
      }).addStyleClass("sapUiTinyMarginTopBottom");

      oMessagesBox.addItem(oUserMessageHBox);

      this.scrollToBottom();

      // Simulate server response
      setTimeout(function () {
        fetch("https://jsonplaceholder.typicode.com/posts/1")
          .then(response => {
            if (!response.ok) {
              throw new Error("Server responded with status " + response.status);
            }
            return response.json();
          })
          .then(data => {
            var serverResponseText = "Thanks for your message! I'll help you with that.";

            var oServerMessageHBox = new HBox({
              justifyContent: "End",
              width: "100%",
              items: [
                new MessageStrip({
                  text: serverResponseText,
                  showIcon: false,
                }),
                new Avatar({
                  displayShape: "Circle",
                  displaySize: "XS",
                  initials: "AI"
                })
              ]
            }).addStyleClass("sapUiTinyMarginTopBottom");

            oMessagesBox.addItem(oServerMessageHBox);

            this.scrollToBottom();
          })
          .catch(error => {
            MessageToast.show("Error: " + error.message);

            var oErrorMessageHBox = new HBox({
              justifyContent: "End",
              width: "100%",
              items: [
                new MessageStrip({
                  text: "Sorry, I'm having trouble connecting right now. Please try again later.",
                  showIcon: false,
                  type: "Error",
                  width: "auto"
                }),
                new Avatar({
                  displayShape: "Circle",
                  displaySize: "XS",
                  initials: "AI"
                })
              ]
            }).addStyleClass("sapUiTinyMarginTopBottom");

            oMessagesBox.addItem(oErrorMessageHBox);
            this.scrollToBottom();
          })
          .finally(() => {
            // Remove busy state from send button
            this.getView().getModel("oSubmitStateModel").setProperty("/chatBusy", false);
          });
      }.bind(this), 1000); // Simulate network delay
    },

    scrollToBottom: function () {
      setTimeout(function () {
        var oScrollContainer = this.byId("idMessagesScrollContainer");
        if (oScrollContainer) {
          oScrollContainer.scrollTo(0, 999999, 500);
        }
      }.bind(this), 100);
    },
  });
});