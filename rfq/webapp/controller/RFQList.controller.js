sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
  ],
  (Controller, Filter, FilterOperator) => {
    "use strict";

    return Controller.extend("com.aisp.rfq.controller.RFQList", {
      onInit() {
        this.oRouter = this.getOwnerComponent().getRouter();
        this.oRouter.getRoute("RouteRFQList").attachPatternMatched(this._onRouteMatched, this);
      },

      _onRouteMatched: function (oEvent) {
        // Rebind both SmartTables to refresh their data
        this._rebindSmartTables();
      },

      _rebindSmartTables: function () {
        // Get references to the SmartTable controls
        const oSmartTableHDR = this.byId("smartTableHDR");
        const oSmartTableDraft = this.byId("smartTableDraft");

        // Rebind smartTableHDR
        if (oSmartTableHDR) {
          oSmartTableHDR.rebindTable();
        } else {
          console.error("SmartTableHDR not found");
        }

        // Rebind smartTableDraft
        if (oSmartTableDraft) {
          oSmartTableDraft.rebindTable();
        } else {
          console.error("SmartTableDraft not found");
        }
      },

      onBeforeRebindTable: function (oEvent) {
        const oBindingParams = oEvent.getParameter("bindingParams");
        const oSmartTable = oEvent.getSource();
        let filter;

        switch (oSmartTable.getId()) {
          case this.createId("smartTableHDR"):
            filter = new Filter("Status", FilterOperator.NE, "Draft");
            break;
          case this.createId("smartTableDraft"):
            filter = new Filter("Status", FilterOperator.EQ, "Draft");
            break;
          default:
            return;
        }

        oBindingParams.filters.push(filter);
      },

      onRFQListItemPress: function (oEvent) {
        let oSource = oEvent.getSource();
        let oContext = oSource.getBindingContext();
        let oData = oContext.getObject();
        let { RfqNumber, Bidder } = oData;

        this.getOwnerComponent().getRouter().navTo("RouteRFQDetails", {
          rfqNum: RfqNumber,
          bidder: Bidder,
        });
      },

      onDraftItemPress: function (oEvent) {
        let oSource = oEvent.getSource();
        let oContext = oSource.getBindingContext();
        let oData = oContext.getObject();
        let { RfqNumber, Bidder } = oData;

        this.getOwnerComponent().getRouter().navTo("RouteRFQDraft", {
          rfqNum: RfqNumber,
          bidder: Bidder,
        });
      },

      formatStatusState: function (sStatus) {
        switch (sStatus) {
          case "Pending":
            return "Indication13";
          case "Submitted":
            return "Indication14";
          case "Awarded":
            return "Indication18";
          case "Accepted":
            return "Indication15";
          case "Rejected":
            return "Indication11";
          case "Draft":
            return "Indication16";
          default:
            return "None";
        }
      },

      formatTimeRemaining: function (deadlineTimestamp) {
        // Handle null/undefined/empty values
        debugger;
        if (!deadlineTimestamp) {
          return "No deadline set";
        }

        // Parse the timestamp whether it comes as string or number
        let timestamp;
        if (typeof deadlineTimestamp === "string") {
          // Handle OData format "/Date(timestamp)/"
          const match = deadlineTimestamp.match(/\d+/);
          timestamp = match ? parseInt(match[0]) : null;
        } else if (typeof deadlineTimestamp === "number") {
          // Handle raw timestamp
          timestamp = deadlineTimestamp;
        } else if (deadlineTimestamp instanceof Date) {
          // Handle Date object directly
          timestamp = deadlineTimestamp.getTime();
        }

        // If we couldn't parse a valid timestamp
        if (!timestamp) {
          return "Invalid deadline";
        }

        const deadlineDate = new Date(timestamp);
        const now = new Date();
        const diffMs = deadlineDate - now;

        // If deadline has passed
        if (diffMs <= 0) {
          return "Deadline passed";
        }

        // Calculate time remaining
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(
          (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
        );

        return `${diffDays}d ${diffHours}h remaining`;
      },

      formatTimeRemainingState: function (deadlineTimestamp) {
        if (!deadlineTimestamp) {
          return "None";
        }

        // Parse the timestamp (same logic as above)
        let timestamp;
        if (typeof deadlineTimestamp === "string") {
          const match = deadlineTimestamp.match(/\d+/);
          timestamp = match ? parseInt(match[0]) : null;
        } else if (typeof deadlineTimestamp === "number") {
          timestamp = deadlineTimestamp;
        } else if (deadlineTimestamp instanceof Date) {
          timestamp = deadlineTimestamp.getTime();
        }

        if (!timestamp) {
          return "None";
        }

        const deadlineDate = new Date(timestamp);
        const now = new Date();
        const diffMs = deadlineDate - now;

        if (diffMs <= 0) {
          return "Error";
        }

        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays > 3) return "Success";
        if (diffDays > 1) return "Warning";
        return "Error";
      },

      calculateProgressPercentage: function (deadlineTimestamp) {
        if (!deadlineTimestamp) {
          return 0;
        }

        // Parse the timestamp (same logic as above)
        let timestamp;
        if (typeof deadlineTimestamp === "string") {
          const match = deadlineTimestamp.match(/\d+/);
          timestamp = match ? parseInt(match[0]) : null;
        } else if (typeof deadlineTimestamp === "number") {
          timestamp = deadlineTimestamp;
        } else if (deadlineTimestamp instanceof Date) {
          timestamp = deadlineTimestamp.getTime();
        }

        if (!timestamp) {
          return 0;
        }

        const deadlineDate = new Date(timestamp);
        const now = new Date();
        const totalDuration = deadlineDate - now;

        // If deadline has passed, show 100%
        if (totalDuration <= 0) {
          return 100;
        }

        // Calculate percentage of time passed (0-100%)
        const timePassed =
          now - new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const percentage = (timePassed / totalDuration) * 100;

        return Math.min(100, Math.max(0, Math.round(percentage)));
      },

      formatDate: function (dateValue) {
        if (!dateValue || !(dateValue instanceof Date)) return "-";
        const day = String(dateValue.getDate()).padStart(2, "0");
        const month = String(dateValue.getMonth() + 1).padStart(2, "0");
        const year = dateValue.getFullYear();
        return `${day}-${month}-${year}`;
      },

      onIconTabBarSelect: function (oEvent) {
        const selectedKey = oEvent.getParameter("key");
        if (selectedKey === "RFQ-Event") {
          const oSmartTable = this.byId("smartTableHDR");
          if (oSmartTable) {
            oSmartTable.rebindTable();
            this.getView().byId("smartFilterBar").setVisible(true);
            this.getView().byId("smartFilterBarDraft").setVisible(false);
          }
        } else if (selectedKey === "Drafts") {
          const oSmartTable = this.byId("smartTableDraft");
          if (oSmartTable) {
            oSmartTable.rebindTable();
            this.getView().byId("smartFilterBar").setVisible(false);
            this.getView().byId("smartFilterBarDraft").setVisible(true);
          }
        }
      },
    });
  }
);
