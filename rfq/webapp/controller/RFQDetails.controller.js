sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/core/Fragment",
  "sap/ui/export/Spreadsheet",
  "sap/ui/export/library",
  "sap/ui/export/ExportHandler",
  "sap/ui/core/format/DateFormat",
  "sap/ui/core/ws/WebSocket",
], function (
  Controller,
  Filter,
  FilterOperator,
  JSONModel,
  MessageBox,
  MessageToast,
  Fragment,
  Spreadsheet,
  library,
  ExportHandler,
  DateFormat,
  WebSocket
) {
  "use strict";

  return Controller.extend("com.aisp.rfq.controller.RFQDetails", {
    // Configuration constants
    CONFIG: {
      MAX_FILE_SIZE_MB: 3,
      MAX_ADDITIONAL_FILE_SIZE_MB: 1,
      COUNTDOWN_INTERVAL: 1000,
      PREVIEWABLE_TYPES: ["image/jpeg", "image/png", "image/gif", "application/pdf", "text/plain"],
      STATUS: {
        PENDING: "Pending",
        ACCEPTED: "Accepted",
        SUBMITTED: "Submitted",
        AWARDED: "Awarded",
        REJECTED: "Rejected",
        DRAFT: "Draft",
        NOT_ACCEPTED: "Not_Accepted",
      },
      SUBMISSION_STATES: {
        CREATING: "creating",
        EDITING: "editing",
        PREVIEW: "preview",
        SUBMITTING: "submitting"
      }
    },

    _getMimeType: function (sExtension) {
      const mMimeTypes = {
        pdf: "application/pdf",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        txt: "text/plain"
      };
      return mMimeTypes[sExtension] || "";
    },

    /* === INITIALIZATION === */
    onInit: function () {
      this.oRouter = this.getOwnerComponent().getRouter();
      this.oRouter.getRoute("RouteRFQDetails").attachPatternMatched(this._onRouteMatched, this);
    },

    _initializeModels: function () {
      // UI state model
      const oUIState = {
        sections: {
          preRequisite: { visible: false, enabled: true },
          createQuotation: { visible: false, enabled: true },
          awardedResults: { visible: false, enabled: true },
          rejectedResults: { visible: false, enabled: true },
          preview: { visible: false, enabled: true },
        },
        buttons: {
          accept: { visible: true, enabled: true },
          reject: { visible: true, enabled: true },
          confirm: { visible: false, enabled: false },
          submit: { visible: false, enabled: false },
          draft: { visible: false, enabled: false },
          finalSubmit: { visible: false, enabled: false },
          finalDraft: { visible: false, enabled: false },
          revisePreRequisite: { visible: false, enabled: false },
          reviseQuotation: { visible: false, enabled: false },
          updatePreRequisite: { visible: false, enabled: false },
          updateQuotation: { visible: false, enabled: false },
          addCharge: { visible: true, enabled: true },
          deleteCharge: { visible: true, enabled: true }
        },
        submission: { state: this.CONFIG.SUBMISSION_STATES.CREATING, isSubmitting: false }
      };

      this._setModel("uiState", oUIState);

      let dataModels = ["oHeaderModel", "oItemsModel", "oWorkHeaderModel", "oWorkItemsModel"];

      // Data models
      dataModels.forEach(sName => {
        // this._setModel(sName, { results: [] });
        this.sName = this._setModel(sName, { results: [] });
      });
      // "oQuestionsModel", "oAttachmentsModel"
      this._setModel("oQuestionsModel", { questions: [] });
      this._setModel("oAttachmentsModel", { attachments: [] });
      this._setModel("oSelectedOptionModel", { selectedOption: "Manual" });
      this._setModel("oCountdownModel", { days: "--", hours: "--", mins: "--", secs: "--" });
      this._setModel("oTotalModel", { TotalQuotationValue: "0.00" });
    },

    _setModel: function (sName, oData) {
      this.getView().setModel(new JSONModel(oData), sName);
    },

    /* === ROUTE HANDLING === */
    _onRouteMatched: async function (oEvent) {
      this._setBusy(true);
      const { rfqNum, bidder } = oEvent.getParameter("arguments");

      if (!rfqNum || !bidder) {
        this._showError("Invalid RFQ or Bidder ID");
        this._navigateToList();
        return;
      }

      this.initialiseSocket();

      this.rfqNumber = rfqNum;
      this.Bidder = bidder;
      this.getMaterialsName(rfqNum, bidder);

      try {
        this._initializeModels();
        await this._loadData(rfqNum, bidder);
      } catch (oError) {
        this._showError(`Failed to load data: ${oError.message}`);
      } finally {
        this._setBusy(false);
      }
    },

    /* === UI STATE MANAGEMENT === */
    _updateUIState: function (sStatus) {
      const oUIState = this.getView().getModel("uiState").getData();
      const oWorkHeaderData = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0") || {};

      // Log initial state for debugging
      console.log("Updating UI State:", {
        RFQStatus: sStatus,
        ResponseStatus: oWorkHeaderData.ResponseStatus,
        AttachmentStatus: oWorkHeaderData.AttachmentStatus,
        CurrentUIState: oUIState
      });

      // Reset UI state
      this.__resetUIState(oUIState);

      // Handle UI state based on RFQ status
      switch (sStatus) {
        case this.CONFIG.STATUS.PENDING:
          this._toggleButtonsVisibility(["accept", "reject"], true);
          this._toggleButtonsState(["accept", "reject"], true);
          break;
        case this.CONFIG.STATUS.ACCEPTED:
          this._handleAcceptedStatus(oUIState, oWorkHeaderData);
          break;
        case this.CONFIG.STATUS.NOT_ACCEPTED:
          this._toggleButtonsVisibility(["accept"], true);
          this._toggleButtonsVisibility(["reject"], false);
          break;
        case this.CONFIG.STATUS.SUBMITTED:
          this._handleSubmittedStatus(oUIState);
          break;
        case this.CONFIG.STATUS.AWARDED:
          this._toggleSectionsVisibility(["preRequisite", "createQuotation"], true);
          this._setSectionVisibility("awardedResults", true);
          this._setSectionEnabledState("createQuotation", oWorkHeaderData.ResponseStatus === "Completed" && oWorkHeaderData.AttachmentStatus === "Completed");
          break;
        case this.CONFIG.STATUS.REJECTED:
          this._toggleSectionsVisibility(["preRequisite", "createQuotation"], true);
          this._setSectionVisibility("rejectedResults", true);
          break;
        case this.CONFIG.STATUS.DRAFT:
          this._handleDraftStatus(oUIState);
          break;
      }

      // Log final UI state
      console.log("Final UI State:", oUIState);

      // Update and refresh UI state model
      this.getView().getModel("uiState").setData(oUIState);
      this.getView().getModel("uiState").refresh(true);

      // Force re-render to ensure UI updates
      this.getView().rerender();
    },

    __resetUIState: function (oUIState) {
      Object.keys(oUIState.sections).forEach(sKey => {
        oUIState.sections[sKey].visible = false;
        oUIState.sections[sKey].enabled = false;
      });
      Object.keys(oUIState.buttons).forEach(sKey => {
        oUIState.buttons[sKey].visible = false;
        oUIState.buttons[sKey].enabled = false;
      });
      oUIState.submission.isSubmitting = false;
    },

    /* === Helper Functions for Each Status === */
    // Handle Accepted Status
    _handleAcceptedStatus: function (oUIState, oWorkHeaderData) {
      this._toggleSectionsVisibility(["preRequisite"], true);
      this._toggleSectionsState(["preRequisite"], true);
      this._toggleButtonsVisibility(["confirm"], true);
      this._toggleButtonsState(["confirm"], true);

      if (oWorkHeaderData.ResponseStatus === "Completed" && oWorkHeaderData.AttachmentStatus === "Completed") {
        this._toggleSectionsVisibility(["createQuotation"], true);
        this._toggleSectionsState(["createQuotation"], true);
        this._toggleButtonsVisibility(["submit", "draft"], true);
        this._toggleButtonsState(["submit", "draft"], true);
        this._toggleButtonsVisibility(["confirm"], false);
        this._toggleButtonsState(["confirm"], false);
      }

      if (oUIState.submission.state === this.CONFIG.SUBMISSION_STATES.PREVIEW) {
        this._toggleButtonsVisibility(["addCharge", "deleteCharge", "submit", "draft", "finalDraft"], false);
        this._toggleButtonsState(["addCharge", "deleteCharge", "submit", "draft", "finalDraft"], false);

        this._toggleButtonsVisibility(["finalSubmit"], true);
        this._toggleButtonsState(["finalSubmit"], true);

        this._toggleSectionsVisibility(["preview"], true);
        this._toggleSectionsState(["preview"], true);

      } else {
        this._toggleButtonsVisibility(["addCharge", "deleteCharge"], true);
        this._toggleButtonsState(["addCharge", "deleteCharge"], true);
      }
    },

    // Handle Submitted Status
    _handleSubmittedStatus: function (oUIState) {
      this._toggleSectionsVisibility(["preRequisite", "createQuotation"], true);
      this._setSectionEnabledState("preRequisite", true);
      this._setSectionEnabledState("createQuotation", true);

      this._toggleButtonsVisibility(["revisePreRequisite", "reviseQuotation"], true);
      this._toggleButtonsState(["revisePreRequisite", "reviseQuotation"], true);

      this._toggleButtonsVisibility(["submit", "draft"], false);
      this._toggleButtonsState(["submit", "draft", "addCharge", "deleteCharge"], false);

      if (oUIState.submission.state === this.CONFIG.SUBMISSION_STATES.PREVIEW) {
        this._enableButton("finalSubmit");
      }

    },

    // Handle Draft Status
    _handleDraftStatus: function (oUIState) {
      this._toggleSectionsVisibility(["preRequisite", "createQuotation", "preview"], true);
      this._toggleButtonsVisibility(["finalDraft"], true);
      this._toggleButtonsState(["finalDraft"], true);

      if (oUIState.submission.state === this.CONFIG.SUBMISSION_STATES.PREVIEW) {
        this._toggleButtonsVisibility(
          ["accept", "reject", "confirm", "submit", "draft", "finalSubmit", "addCharge", "deleteCharge"],
          false
        );
      }
    },

    /* === Helper Functions === */
    // Toggle visibility and enabled state for multiple sections at once
    _toggleSectionsVisibility: function (sections, isVisible) {
      const oUIState = this.getView().getModel("uiState").getData();
      sections.forEach(section => {
        oUIState.sections[section].visible = isVisible;
      });
      this.getView().getModel("uiState").setData(oUIState);
    },

    _toggleSectionsState: function (sections, isEnabled) {
      const oUIState = this.getView().getModel("uiState").getData();
      sections.forEach(section => {
        oUIState.sections[section].enabled = isEnabled;
      });
      this.getView().getModel("uiState").setData(oUIState);
    },

    // Toggle visibility and enabled state for multiple buttons at once
    _toggleButtonsVisibility: function (buttons, isVisible) {
      const oUIState = this.getView().getModel("uiState").getData();
      buttons.forEach(button => {
        oUIState.buttons[button].visible = isVisible;
      });
      this.getView().getModel("uiState").setData(oUIState);
    },

    _toggleButtonsState: function (buttons, isEnabled) {
      const oUIState = this.getView().getModel("uiState").getData();
      buttons.forEach(button => {
        oUIState.buttons[button].enabled = isEnabled;
      });
      this.getView().getModel("uiState").setData(oUIState);
    },

    // Enable button
    _enableButton: function (sButton) {
      const oUIState = this.getView().getModel("uiState").getData();
      oUIState.buttons[sButton].visible = true;
      oUIState.buttons[sButton].enabled = true;
      this.getView().getModel("uiState").setData(oUIState);
    },

    // Disable button
    _disableButton: function (sButton) {
      const oUIState = this.getView().getModel("uiState").getData();
      oUIState.buttons[sButton].visible = false;
      oUIState.buttons[sButton].enabled = false;
      this.getView().getModel("uiState").setData(oUIState);
    },

    // Set visibility for section
    _setSectionVisibility: function (sSection, bVisibility) {
      const oUIState = this.getView().getModel("uiState").getData();
      oUIState.sections[sSection].visible = bVisibility;
      this.getView().getModel("uiState").setData(oUIState);
    },

    // Set enabled state for section based on submission state
    _setSectionEnabledState: function (sSection, state) {
      const oUIState = this.getView().getModel("uiState").getData();
      oUIState.sections[sSection].enabled = state === this.CONFIG.SUBMISSION_STATES.EDITING;
      this.getView().getModel("uiState").setData(oUIState);
    },

    // Set visibility for button
    _setButtonVisibility: function (sButton, bVisibility) {
      const oUIState = this.getView().getModel("uiState").getData();
      oUIState.buttons[sButton].visible = bVisibility;
      this.getView().getModel("uiState").setData(oUIState);
    },

    /* === DATA LOADING === */
    _loadData: async function (rfqNum, bidder) {
      const oHeaderModel = this.getView().getModel("oHeaderModel");
      const oWorkItemsModel = this.getView().getModel("oWorkItemsModel");

      let aFilters = [
        new Filter("RfqNumber", FilterOperator.EQ, rfqNum),
        new Filter("Bidder", FilterOperator.EQ, bidder)
      ]

      await Promise.all([
        this._loadEntity("/ZC_AISP_RFQ_HDR", aFilters, "oHeaderModel"),
        this._loadEntity("/ZC_AISP_RFQ_ITEM", aFilters, "oItemsModel"),
        this._loadEntity("/ZC_AISP_RFQ_WORK_HDR", aFilters, "oWorkHeaderModel"),
        this._loadEntity("/ZC_AISP_RFQ_WORK_ITEM", aFilters, "oWorkItemsModel")
      ]);

      const oHeaderData = oHeaderModel.getProperty("/results/0");
      const workItemData = oWorkItemsModel.getProperty("/results");
      const accountGroup = oHeaderData.VendorAccgrp;

      if (accountGroup) {
        await this._loadDynamicSections(accountGroup, rfqNum, bidder);
        this._startCountdown(oHeaderData.Deadline_dt);
        this._updateUIState(oHeaderData.Status);
      }

      if (workItemData) {
        this._convertISOToDate(workItemData, oWorkItemsModel)
      }

    },

    _convertISOToDate: function (workItemData, oWorkItemsModel) {
      if (workItemData && workItemData.length > 0) {
        const updatedItems = workItemData.map(item => {
          // If dates are already in "2025-09-09" string format, convert to Date objects
          const convertDate = (dateValue) => {
            if (!dateValue) {
              return null;
            }
            // Create a DateFormat instance for the desired output format
            const oDateFormat = DateFormat.getInstance({ pattern: "yyyy-MM-dd" });
            return oDateFormat.format(dateValue);
          };

          return {
            ...item,
            DeliveryDate: convertDate(item.DeliveryDate),
            ExpectedDeliveryDate: convertDate(item.ExpectedDeliveryDate)
          };
        });

        oWorkItemsModel.setProperty("/results", updatedItems);
      }
    },

    _loadDynamicSections: async function (accountGroup, rfqNum, bidder) {
      const errors = [];

      await Promise.all([
        this._loadQuestionsSection(accountGroup, rfqNum, bidder).catch(error => errors.push(error.message || "Failed to load questions")),
        this._loadAttachmentsSection(accountGroup, rfqNum, bidder).catch(error => errors.push(error.message || "Failed to load attachments"))
      ]);

      // Display combined error message if any errors occurred
      if (errors.length > 0) {
        const errorMessage = errors.length === 2
          ? "No pre-requisite questions or attachments defined by admin"
          : errors[0];

        this._showError(errorMessage);
      }
    },

    _loadQuestionsSection: async function (accountGroup, rfqNum, bidder) {
      // const oUIStateModel = this.getView().getModel("uiState");
      const oQuestionsModel = this.getView().getModel("oQuestionsModel");

      let aFilters = [new Filter("ACCOUNT_GROUP", FilterOperator.EQ, accountGroup)]

      const questions = await this._fetchEntity("/SupplierPreReqQstns", aFilters);

      // If no questions set by admin throw an error
      if (!questions?.length) {
        // oUIStateModel.setProperty("/sections/preRequisite/enabled", false);
        oQuestionsModel.setProperty("/questions", []);
        throw new Error("No pre-requisite questions defined by admin");
      }

      // Initialize questions with default responses based on type
      const initializedQuestions = questions.map(q => {
        let defaultResponse = "";
        let questionType = q.QUESTION_TYPE.toUpperCase();

        if (questionType === 'RADIO') {
          defaultResponse = "Yes"; // Default to "Yes" for radio buttons
        } else if (questionType === 'DROPDOWN' && q.DROPDOWN_OPTIONS && q.DROPDOWN_OPTIONS.length > 0) {
          // Set first option as default fq.QUESTION_TYPEor dropdowns
          defaultResponse = q.DROPDOWN_OPTIONS[0].VALUE;
        }

        return {
          ...q,
          RESPONSE: defaultResponse
        };
      });

      // Check if already responded
      const respSts = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0/ResponseStatus");

      // If Responded fetch the previous response
      if (respSts === "Completed") {
        await this._fetchPreviousResponses(rfqNum, bidder, accountGroup, initializedQuestions);
      }

      oQuestionsModel.setProperty("/questions", initializedQuestions);
    },

    _loadAttachmentsSection: async function (accountGroup, rfqNum, bidder) {
      // const oUIStateModel = this.getView().getModel("uiState");
      const oAttachmentsModel = this.getView().getModel("oAttachmentsModel");
      const attachments = await this._fetchEntity("/SupplierPreReqAttchmnts", [new Filter("ACCOUNT_GROUP", FilterOperator.EQ, accountGroup)]);

      // If no attachments set by admin throw an error
      if (!attachments?.length) {
        // oUIStateModel.setProperty("/sections/preRequisite/enabled", false);
        oAttachmentsModel.setProperty("/attachments", []);
        throw new Error("No pre-requisite attachments defined by admin");
      }

      // Add Default Attachement Response Here
      const initializedAttachments = attachments.map(a => ({
        ...a,
        RESPONSE_DESCRIPTION: "",
        RESPONSE_FILE_NAME: "",
        RESPONSE_FILE_URL: "",
        RESPONSE_REASON_FOR_ABSENCE: "",
        IS_PRESENT: false
      }));

      // Check if already responded
      const attSts = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0/AttachmentStatus");

      // If Responded fetch the previous response
      if (attSts === "Completed") {
        await this._fetchPreviousAttachments(rfqNum, bidder, accountGroup, initializedAttachments);
      }

      oAttachmentsModel.setProperty("/attachments", initializedAttachments);
    },

    // Fetch previous responses for MongoDB structure
    _fetchPreviousResponses: async function (rfqNum, bidder, accountGroup, questions) {
      try {
        const aFilters = [
          new Filter("RfqNumber", FilterOperator.EQ, rfqNum),
          new Filter("Bidder", FilterOperator.EQ, bidder),
          new Filter("ACCOUNT_GROUP", FilterOperator.EQ, accountGroup)
        ];

        const previousResponses = await this._fetchEntity("/SupplierResponses", aFilters);

        if (previousResponses && previousResponses.length > 0) {
          // Assuming we get the latest response document
          const latestResponse = previousResponses[0];

          if (latestResponse.RESPONSES && latestResponse.RESPONSES.length > 0) {
            questions.forEach(question => {
              const response = latestResponse.RESPONSES.find(r => r.QUESTION_ID === question.QUESTION_ID);
              if (response) {
                question.RESPONSE = response.RESPONSE_TEXT;
                // RESPONSE_TEXT contains "Yes"/"No" for radio or option key for dropdown
              }
            });
          }
        }
      } catch (error) {
        console.error("Error fetching previous responses:", error);
      }
    },

    _fetchPreviousAttachments: async function (rfqNum, bidder, accountGroup, attachments) {
      let aFilters = [
        new Filter("RfqNumber", FilterOperator.EQ, rfqNum),
        new Filter("Bidder", FilterOperator.EQ, bidder),
        new Filter("ACCOUNT_GROUP", FilterOperator.EQ, accountGroup)
      ];

      const attachmentData = await this._fetchEntity("/SupplierAttachments", aFilters);
      const previousAttachments = attachmentData?.[0]?.Attachments || [];

      attachments.forEach(a => {
        const prevAttachment = previousAttachments.find(att => att.DOCUMENT_ID === a.DOCUMENT_ID);
        if (prevAttachment) {
          a.RESPONSE_DESCRIPTION = prevAttachment.DESCRIPTION || "";
          a.RESPONSE_FILE_NAME = prevAttachment.FILE_NAME || "";
          a.RESPONSE_FILE_URL = prevAttachment.FILE_URL || "";
          a.RESPONSE_REASON_FOR_ABSENCE = prevAttachment.REASON_FOR_ABSENCE || "";
          a.IS_PRESENT = !!prevAttachment.FILE_URL;
        }
      });
    },

    // Event handler for answer selection
    onAnswerSelect: function (oEvent) {
      const oSource = oEvent.getSource();
      let oQuestionsModel = this.getView().getModel("oQuestionsModel")
      const bindingContext = oSource.getBindingContext("oQuestionsModel");

      let selectedValue = "";

      if (oSource.isA("sap.m.RadioButtonGroup")) {
        const selectedIndex = oEvent.getParameter("selectedIndex");
        selectedValue = selectedIndex === 0 ? "Yes" : "No";
      } else if (oSource.isA("sap.m.Select")) {
        selectedValue = oEvent.getParameter("selectedItem").getText();
      }

      // Update the response in model
      oQuestionsModel.setProperty(bindingContext.getPath() + "/RESPONSE", selectedValue);
      oQuestionsModel.refresh();
    },

    /* === COUNTDOWN TIMER === */
    _startCountdown: function (sDeadline) {
      if (!sDeadline) return;
      const oDeadline = new Date(sDeadline);

      if (isNaN(oDeadline)) {
        this._showError("Invalid deadline date for countdown");
        return;
      }

      if (this._countdownInterval) clearInterval(this._countdownInterval);
      this._updateCountdown(oDeadline);
      this._countdownInterval = setInterval(() => this._updateCountdown(oDeadline), this.CONFIG.COUNTDOWN_INTERVAL);
    },

    _updateCountdown: function (oDeadline) {
      const diff = Math.max(0, (oDeadline - new Date()) / 1000);
      if (diff === 0) clearInterval(this._countdownInterval);

      const secsTotal = Math.floor(diff);
      this.getView().getModel("oCountdownModel").setData({
        days: String(Math.floor(secsTotal / 86400)).padStart(2, "0"),
        hours: String(Math.floor((secsTotal % 86400) / 3600)).padStart(2, "0"),
        mins: String(Math.floor((secsTotal % 3600) / 60)).padStart(2, "0"),
        secs: String(secsTotal % 60).padStart(2, "0")
      });
    },

    /* === HANDLERS === */
    _fetchEntity: function (sPath, aFilters) {
      return new Promise((resolve, reject) => {
        this.getView().getModel().read(sPath, {
          filters: aFilters,
          success: oData => resolve(oData.results),
          error: reject
        });
      });
    },

    _loadEntity: function (sPath, aFilters, sModelName) {
      return new Promise((resolve, reject) => {
        this.getView().getModel().read(sPath, {
          filters: aFilters,
          success: oData => {
            this.getView().getModel(sModelName).setProperty("/results", oData.results || []);
            resolve();
          },
          error: reject
        });
      });
    },

    _createEntity: function (sPath, oPayload) {
      return new Promise((resolve, reject) => {
        this.getView().getModel().create(sPath, oPayload, {
          success: (oData) => {
            resolve(oData);
          },
          error: (oError) => {
            reject(oError);
          }
        });
      });
    },


    /* === VALIDATION === */
    _isDeadlinePassed: function () {
      // return false;
      const oHeaderData = this.getView().getModel("oHeaderModel").getProperty("/results/0");
      return oHeaderData?.Deadline_dt && new Date() > new Date(oHeaderData.Deadline_dt);
    },

    _validateFile: function (oFile, bIsAdditional = false) {
      if (!oFile) {
        this._showError("No file selected");
        return false;
      }
      const maxSize = (bIsAdditional ? this.CONFIG.MAX_ADDITIONAL_FILE_SIZE_MB : this.CONFIG.MAX_FILE_SIZE_MB) * 1024 * 1024;
      if (oFile.size > maxSize) {
        this._showError(`File size exceeds ${bIsAdditional ? this.CONFIG.MAX_ADDITIONAL_FILE_SIZE_MB : this.CONFIG.MAX_FILE_SIZE_MB} MB limit`);
        return false;
      }
      return true;
    },

    _validatePreRequisites: function (aQuestions, aAttachments) {
      const errors = [];

      // Check for admin-defined questions and attachments
      if (!aQuestions.length && !aAttachments.length) {
        errors.push("No pre-requisite questions or attachments defined by admin");
      } else {
        if (!aQuestions.length) {
          errors.push("No pre-requisite questions defined by admin");
        }
        if (!aAttachments.length) {
          errors.push("No pre-requisite attachments defined by admin");
        }
      }

      // Validate questions
      const aInvalidQuestions = aQuestions.filter(q => !q.RESPONSE);
      if (aInvalidQuestions.length) {
        errors.push("Please answer all questions");
      }

      // Validate attachments
      const aInvalidAttachments = aAttachments.filter(a =>
        (!a.IS_PRESENT && !a.RESPONSE_REASON_FOR_ABSENCE) ||
        !a.RESPONSE_DESCRIPTION ||
        (a.IS_PRESENT && (!a.RESPONSE_FILE_NAME || !a.RESPONSE_FILE_URL || !a.RESPONSE_DESCRIPTION))
      );

      if (aInvalidAttachments.length) {
        // Case 1: Nothing provided (no file, no reason, no description)
        const nothingProvided = aInvalidAttachments
          .filter(a => !a.IS_PRESENT && !a.RESPONSE_REASON_FOR_ABSENCE && !a.RESPONSE_DESCRIPTION)
          .map(a => a.DESCRIPTION);
        if (nothingProvided.length) {
          errors.push(`No file, reason, or description provided for: ${nothingProvided.join(", ")}`);
        }

        // Case 2: Missing file and reason (but may have description)
        const missingFileOrReason = aInvalidAttachments
          .filter(a => !a.IS_PRESENT && !a.RESPONSE_REASON_FOR_ABSENCE)
          .map(a => a.DESCRIPTION);
        if (missingFileOrReason.length) {
          errors.push(`Please provide a file or reason for: ${missingFileOrReason.join(", ")}`);
        }

        // Case 3: Missing description for uploaded files
        const missingDescription = aInvalidAttachments
          .filter(a => !a.RESPONSE_DESCRIPTION)
          .map(a => a.DESCRIPTION);
        if (missingDescription.length) {
          errors.push(`Description is missing for: ${missingDescription.join(", ")}`);
        }

        // Case 4: Missing file name or URL for uploaded files
        const missingFileFields = aInvalidAttachments
          .filter(a => a.IS_PRESENT && (!a.RESPONSE_FILE_NAME || !a.RESPONSE_FILE_URL))
          .map(a =>
            `Missing required fields for ${a.DESCRIPTION}: ${[!a.RESPONSE_FILE_NAME ? 'File Name' : '', !a.RESPONSE_FILE_URL ? 'File URL' : ''].filter(Boolean).join(', ')}`
          );
        if (missingFileFields.length) {
          errors.push(...missingFileFields);
        }
      }

      if (errors.length) {
        this._showError(errors.join("; "));
        return false;
      }

      return true;
    },

    _validateExcelFormat: function (oFile) {
      if (!oFile) return false;
      const sFileType = oFile.type;
      const aValidTypes = [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel"
      ];
      return aValidTypes.includes(sFileType);
    },

    _validateQuotation: function () {
      if (this._isDeadlinePassed()) {
        this._showError("Cannot submit after the deadline has passed");
        return false;
      }

      const aItems = this.getView().getModel("oWorkItemsModel").getProperty("/results");

      const aInvalidItems = aItems.filter(item => !item.Netpr || isNaN(item.Netpr) || item.Netpr <= 0);

      if (aInvalidItems.length) {
        this._showError(`Please enter valid net prices for items: ${aInvalidItems.map(item => item.ItemNumber || item.MaterialNo || "Unknown").join(", ")}`);
        return false;
      }

      return true;
    },

    /* === USER ACTIONS === */
    onRFQAccept: function () {
      if (this._isDeadlinePassed()) {
        this._showError("Cannot Accept RFQ after the deadline has passed");
        return;
      }

      const sStatus = this.getView().getModel("oHeaderModel").getProperty("/results/0/Status");

      if ([this.CONFIG.STATUS.SUBMITTED, this.CONFIG.STATUS.REJECTED, this.CONFIG.STATUS.DRAFT].includes(sStatus)) {
        this._showError(`Cannot accept RFQ when in ${sStatus} status`);
        return;
      }

      this._showConfirm("Are you sure you want to accept this RFQ?", {
        title: "Confirm Accept RFQ",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            this._updateRFQStatus("accept", this.CONFIG.STATUS.ACCEPTED);
          }
        },
        onCancel: () => console.log("Cancelled")
      });
    },

    onRFQReject: function () {
      if (this._isDeadlinePassed()) {
        this._showError("Cannot Reject RFQ after the deadline has passed");
        return;
      }

      const sStatus = this.getView().getModel("oHeaderModel").getProperty("/results/0/Status");

      if ([this.CONFIG.STATUS.SUBMITTED, this.CONFIG.STATUS.REJECTED, this.CONFIG.STATUS.DRAFT].includes(sStatus)) {
        this._showError("Cannot reject RFQ in current status");
        return;
      }

      if (!this._oRejectDialog) {
        Fragment.load({
          id: this.getView().getId(),
          name: "com.aisp.rfq.fragments.RejectRFQDialog",
          controller: this
        }).then(oDialog => {
          this._oRejectDialog = oDialog;
          this.getView().addDependent(oDialog);
          // this._resetRejectDialog();
          this.byId("rejectReasonInput").setValue("");
          this.byId("rejectConfirmBtn").setEnabled(false);
          oDialog.open();
        }).catch(error => {
          this._showError(`Failed to load reject dialog: ${error.message}`);
        });
      } else {
        // this._resetRejectDialog();
        this.byId("rejectReasonInput").setValue("");
        this.byId("rejectConfirmBtn").setEnabled(false);
        this._oRejectDialog.open();
      }
    },

    onRejectReasonChange: function (oEvent) {
      const sValue = oEvent.getSource().getValue().trim();
      this.byId("rejectConfirmBtn").setEnabled(sValue.length > 0);
    },

    onConfirmReject: function () {
      const sReason = this.byId("rejectReasonInput").getValue().trim();
      if (!sReason) {
        this._showError("Please enter a reason for rejection");
        return;
      }

      this._oRejectDialog.close();
      this._updateRFQStatus("reject", this.CONFIG.STATUS.NOT_ACCEPTED);
    },

    onCancelReject: function () {
      this._oRejectDialog.close();
    },

    onConfirmAndProceed: function () {
      if (this._isDeadlinePassed()) {
        this._showError("Cannot perform this action after the deadline has passed");
        return false;
      }

      const aQuestions = this.getView().getModel("oQuestionsModel").getProperty("/questions") || [];
      const aAttachments = this.getView().getModel("oAttachmentsModel").getProperty("/attachments") || [];

      if (!this._validatePreRequisites(aQuestions, aAttachments)) {
        return;
      }

      const oWorkHeaderModel = this.getView().getModel("oWorkHeaderModel");
      const oHeaderModel = this.getView().getModel("oHeaderModel");
      const { RfqNumber, Bidder } = oHeaderModel.getProperty("/results/0");

      this._setBusy(true);

      this._showConfirm("Are you sure you want to save and proceed with the pre-requisites?", {
        title: "Confirm Save RFQ Pre Requisite",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: async (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            try {
              const oResponse = await this._savePreRequisites();

              const oCurrent = oWorkHeaderModel.getProperty("/results/0") || {};

              oWorkHeaderModel.setProperty("/results/0", {
                ...oCurrent,
                ResponseStatus: oResponse?.ResponseStatus || "Completed",
                AttachmentStatus: oResponse?.AttachmentStatus || "Completed",
                ...oResponse
              });

              let aFilters = [
                new Filter("RfqNumber", FilterOperator.EQ, RfqNumber),
                new Filter("Bidder", FilterOperator.EQ, Bidder)
              ]

              await Promise.all([
                this._loadEntity("/ZC_AISP_RFQ_WORK_HDR", aFilters, "oWorkHeaderModel"),
                this._loadEntity("/ZC_AISP_RFQ_WORK_ITEM", aFilters, "oWorkItemsModel")
              ]);

              this._updateUIState(this.CONFIG.STATUS.ACCEPTED);

              // MessageToast.show("Pre-requisites completed successfully");

              this._showSuccess(oResponse?.saveRFQResponseAndAttachments?.message, {
                title: "Success"
              });
            } catch (oError) {
              // Revert status on error
              oWorkHeaderModel.setProperty("/results/0/ResponseStatus", "Pending");
              oWorkHeaderModel.setProperty("/results/0/AttachmentStatus", "Pending");
              this._showError(oError.message || "Failed to save pre-requisites");
            } finally {
              this._setBusy(false);
            }
          } else {
            this._setBusy(false);
          }
        },
        onCancel: () => {
          console.log("Cancelled");
          this._setBusy(false);
        }
      });
    },

    onSubmitRFQ: function () {
      if (!this._validateQuotation()) return;

      this._showConfirm("Are you sure you want to submit the RFQ?", {
        title: "Confirm RFQ Submission",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            this._setSubmissionState(this.CONFIG.SUBMISSION_STATES.PREVIEW, true);
            this._updateUIState(this.CONFIG.STATUS.ACCEPTED);
          }
        },
        onCancel: () => console.log("Cancelled")
      });
    },

    onFinalSubmit: function () {
      this._showConfirm("Are you sure you want to finalize the RFQ submission? You won't be able to make changes after submission.", {
        title: "Confirm Final Submission",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: async (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            try {
              this._setBusy(true);
              this._setSubmissionState(this.CONFIG.SUBMISSION_STATES.SUBMITTING, true);
              let oResponse = await this._submitRFQ();
              this.getView().getModel("oHeaderModel").setProperty("/results/0/Status", this.CONFIG.STATUS.SUBMITTED);
              this._updateUIState(this.CONFIG.STATUS.SUBMITTED);

              let responseMsg = oResponse?.SubmitRFQ?.message || "RFQ submitted successfully"
              let that = this;
              // MessageToast.show("RFQ submitted successfully");
              this._showSuccess(responseMsg, {
                title: "Success",
                actions: [MessageBox.Action.OK],
                onClose: function (sAction) {
                  if (sAction === MessageBox.Action.OK) {
                    that._navigateToList();
                  }
                }
              });
            } catch (oError) {
              this._showError(oError.message || "Failed to submit RFQ");
            } finally {
              this._setSubmissionState(this.CONFIG.SUBMISSION_STATES.PREVIEW);
              this._setBusy(false);
            }
          }
        },
        onCancel: () => console.log("Cancelled")
      });
    },

    onSaveDraft: function () {
      if (!this._validateQuotation()) return;

      this._showConfirm("Are you sure you want to save the RFQ as draft?", {
        title: "Confirm Save Draft",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: async (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            this._setSubmissionState(this.CONFIG.SUBMISSION_STATES.PREVIEW, true);
            this._updateUIState(this.CONFIG.STATUS.DRAFT);
          }
        },
        onCancel: () => console.log("Cancelled")
      });
    },

    onFinalDraft: function () {
      this._showConfirm("Are you sure you want to finalize the draft?", {
        title: "Confirm Final Draft",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: async (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            try {
              let that = this;
              this._setBusy(true);
              let oResponse = await this._saveDraft();

              this.getView().getModel("oHeaderModel").setProperty("/results/0/Status", this.CONFIG.STATUS.DRAFT);
              this._updateUIState(this.CONFIG.STATUS.DRAFT);
              // MessageToast.show("Draft finalized successfully.");
              let responseMsg = (oResponse?.RfqNumber && oResponse?.Bidder) ? `Draft finalized successfully for RFQNumber ${oResponse?.RfqNumber} and Bidder ${oResponse?.Bidder}.` : "Draft finalized successfully"
              this._showSuccess(responseMsg, {
                title: "Success",
                actions: [MessageBox.Action.OK],
                onClose: function (sAction) {
                  if (sAction === MessageBox.Action.OK) {
                    that._navigateToList();
                  }
                }
              });
              // this._navigateToList();
            } catch (oError) {
              this._showError(oError.message || "Failed to finalize draft");
            } finally {
              this._setBusy(false);
            }
          }
        },
        onCancel: () => console.log("Cancelled")
      });
    },

    onRevisePreRequisite: function () {
      // if (!this._validatePreRequisites(aQuestions, aAttachments)) {
      //   return;
      // }

      const oUIState = this.getView().getModel("uiState").getData();

      oUIState.buttons.updatePreRequisite.visible = true;
      oUIState.buttons.updatePreRequisite.enabled = true;

      oUIState.buttons.updateQuotation.visible = false;
      oUIState.buttons.updateQuotation.enabled = false;

      oUIState.sections.preRequisite.enabled = true; // Allow editing pre-requisites
      oUIState.sections.createQuotation.enabled = false; // Allow editing quotation

      oUIState.submission.state = this.CONFIG.SUBMISSION_STATES.EDITING;

      this.getView().getModel("uiState").setData(oUIState);
      this.getView().getModel("uiState").refresh(true);
      MessageToast.show("Now editing pre-requisites");
    },

    onReviseQuotation: function () {
      // if (!this._validateQuotation()) {
      //   return;
      // }

      const oUIState = this.getView().getModel("uiState").getData();

      oUIState.buttons.updateQuotation.visible = true;
      oUIState.buttons.updateQuotation.enabled = true;
      oUIState.buttons.addCharge.visible = true;
      oUIState.buttons.addCharge.enabled = true;
      oUIState.buttons.deleteCharge.visible = true;
      oUIState.buttons.deleteCharge.enabled = true;

      oUIState.buttons.updatePreRequisite.visible = false;
      oUIState.buttons.updatePreRequisite.enabled = false;

      oUIState.sections.preRequisite.enabled = false; // Allow editing pre-requisites
      oUIState.sections.createQuotation.enabled = true; // Allow editing quotation

      oUIState.submission.state = this.CONFIG.SUBMISSION_STATES.EDITING;
      this.getView().getModel("uiState").setData(oUIState);
      this.getView().getModel("uiState").refresh(true);
      MessageToast.show("Now editing quotation");
    },

    onUpdatePreRequisites: function () {
      if (this._isDeadlinePassed()) {
        this._showError("Cannot submit after the deadline has passed");
        return;
      }

      // Logic to save updated pre-requisites
      if (!this._validatePreRequisites(
        this.getView().getModel("oQuestionsModel").getProperty("/questions") || [],
        this.getView().getModel("oAttachmentsModel").getProperty("/attachments") || []
      )) {
        return;
      }

      this._setBusy(true);
      this._showConfirm("Are you sure you want to update the pre-requisites?", {
        title: "Confirm Update Pre-requisites",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: async (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            try {
              let oResponse = await this._updatePreRequisites();
              const oUIState = this.getView().getModel("uiState").getData();
              oUIState.buttons.updatePreRequisite.visible = false;
              oUIState.buttons.updatePreRequisite.enabled = false;
              oUIState.sections.preRequisite.enabled = false; // Disable editing after save
              oUIState.submission.state = this.CONFIG.SUBMISSION_STATES.CREATING;
              this.getView().getModel("uiState").setData(oUIState);
              this.getView().getModel("uiState").refresh(true);
              // MessageToast.show("Pre-requisites updated successfully");
              let reponseMsg = oResponse?.editRFQResponsesAndAttachments?.message || "Pre-requisites updated successfully"
              this._showSuccess(reponseMsg, {
                title: "Success"
              });
            } catch (oError) {
              this._showError(oError.message || "Failed to update pre-requisites");
            } finally {
              this._setBusy(false);
            }
          }
        },
        onCancel: () => {
          this._setBusy(false);
        }
      });
    },

    onUpdateQuotation: function () {
      // Logic to save updated quotation
      if (!this._validateQuotation()) {
        return;
      }

      this._setBusy(true);
      this._showConfirm("Are you sure you want to update the quotation?", {
        title: "Confirm Update Quotation",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: async (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            try {
              let oResponse = await this._updateQuotation();

              const oUIState = this.getView().getModel("uiState").getData();
              oUIState.buttons.updateQuotation.visible = false;
              oUIState.buttons.updateQuotation.enabled = false;
              oUIState.sections.createQuotation.enabled = false; // Disable editing after save
              oUIState.submission.state = this.CONFIG.SUBMISSION_STATES.CREATING;
              this.getView().getModel("uiState").setData(oUIState);
              this.getView().getModel("uiState").refresh(true);
              // MessageToast.show("Quotation updated successfully");

              let reponseMsg = oResponse?.EditRFQ?.message || "Quotation updated successfully"
              this._showSuccess(reponseMsg, {
                title: "Success"
              });
            } catch (oError) {
              this._showError(oError.message || "Failed to update quotation");
            } finally {
              this._setBusy(false);
            }
          }
        },
        onCancel: () => {
          this._setBusy(false);
        }
      });
    },

    /* === DATA OPERATIONS === */
    _updateRFQStatus: function (sAction, sNewStatus) {
      this._setBusy(true);
      const oHeaderModel = this.getView().getModel("oHeaderModel");
      const oWorkHeaderModel = this.getView().getModel("oWorkHeaderModel");
      const oModel = this.getView().getModel();
      const { RfqNumber, Bidder } = oHeaderModel.getProperty("/results/0");
      const oView = this.getView();

      try {
        oModel.callFunction("/setRFQStatus", {
          method: "POST",
          urlParameters: { RfqNumber, Bidder, Action: sAction },
          success: (oData) => {

            const responseString = oData.results || oData.setRFQStatus;
            let message = '';
            let supplierQuotation = '';

            // Parse string response (format: "message | SupplierQuotation=value")
            if (typeof responseString === 'string') {
              const messageParts = responseString.split('|');
              message = messageParts[0].trim();

              const sqMatch = responseString.match(/SupplierQuotation=([^|]+)/);
              supplierQuotation = sqMatch ? sqMatch[1].trim() : '';
            }
            else if (typeof responseString === 'object') {
              message = responseString.message || `RFQ ${sAction}ed successfully`;
              supplierQuotation = responseString.supplierQuotation || '';
            }

            // Prepare filters for refreshing data
            const aFilters = [
              new Filter("RfqNumber", FilterOperator.EQ, RfqNumber),
              new Filter("Bidder", FilterOperator.EQ, Bidder)
            ];

            // Refresh all relevant data
            Promise.all([
              this._loadEntity("/ZC_AISP_RFQ_WORK_HDR", aFilters, "oWorkHeaderModel"),
              this._loadEntity("/ZC_AISP_RFQ_WORK_ITEM", aFilters, "oWorkItemsModel")
            ]).then(() => {
              // Update status in header model
              oHeaderModel.setProperty("/results/0/Status", sNewStatus);
              oHeaderModel.refresh(true);

              // Update UI state
              this._updateUIState(sNewStatus);

              // Show success message
              // MessageToast.show(`RFQ ${sAction}ed successfully`);
              this._showSuccess(message)
              this._setBusy(false);
            }).catch((oError) => {
              this._showError(`Failed to refresh data: ${oError.message}`);
              this._setBusy(false);
            });

          },
          error: (oError) => {
            this._showError(`Failed to update status: ${oError.message}`);
            this._setBusy(false);
          }
        });
      } catch (error) {
        this._showError(`Something went wrong while trying to update the state ${error.message}`)
      }
    },

    _savePreRequisites: function () {
      const { RfqNumber, Bidder, VendorAccgrp } = this.getView().getModel("oHeaderModel").getProperty("/results/0");
      const aQuestions = this.getView().getModel("oQuestionsModel").getProperty("/questions");
      const aAttachments = this.getView().getModel("oAttachmentsModel").getProperty("/attachments");

      const oPayload = {
        RfqNumber,
        Bidder,
        ACCOUNT_GROUP: VendorAccgrp,
        Responses: aQuestions.map(q => ({ QUESTION_ID: q.QUESTION_ID, RESPONSE_TEXT: q.RESPONSE || "" })),
        Attachments: aAttachments.map(a => ({
          DOCUMENT_ID: a.DOCUMENT_ID,
          FILE_NAME: a.IS_PRESENT ? a.RESPONSE_FILE_NAME : "",
          FILE_URL: a.IS_PRESENT ? a.RESPONSE_FILE_URL : "",
          DESCRIPTION: a.RESPONSE_DESCRIPTION,
          IS_PRESENT: a.IS_PRESENT,
          REASON_FOR_ABSENCE: a.IS_PRESENT ? "" : (a.RESPONSE_REASON_FOR_ABSENCE || "")
        }))
      };

      console.log("Saving Pre-requisites with payload:", oPayload);

      return this._createEntity("/saveRFQResponseAndAttachments", oPayload);
    },

    _submitRFQ: async function () {
      if (!this._validateQuotation()) throw new Error("Validation failed");
      const oHeaderData = this.getView().getModel("oHeaderModel").getProperty("/results/0");
      const aItems = this.getView().getModel("oWorkItemsModel").getProperty("/results");
      const oWorkHeaderData = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");

      const oPayload = {
        RfqNumber: oHeaderData.RfqNumber,
        Bidder: oHeaderData.Bidder,
        items: aItems,
        Additional_Charge_Present: !!oWorkHeaderData.Additional_Charges?.length,
        Additional_Charges: oWorkHeaderData.Additional_Charges || [],
        Remarks: oWorkHeaderData.Remarks || "",
        Additional_Attachment_Present: !!oWorkHeaderData.Additional_Attachments?.length,
        Additional_Attachments: oWorkHeaderData.Additional_Attachments || []
      };

      return this._createEntity("/SubmitRFQ", oPayload);
    },

    _saveDraft: async function () {
      const oHeaderData = this.getView().getModel("oHeaderModel").getProperty("/results/0");
      const aWorkItems = this.getView().getModel("oWorkItemsModel").getProperty("/results");
      const oWorkHeaderData = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");

      const oDraftData = {
        RfqNumber: oHeaderData.RfqNumber,
        Bidder: oHeaderData.Bidder,
        Status: this.CONFIG.STATUS.DRAFT,
        items: aWorkItems.map(oItem => ({
          RfqNumber: oHeaderData.RfqNumber,
          ItemNumber: oItem.ItemNumber,
          Bidder: oHeaderData.Bidder,
          Netpr: oItem.Netpr || "0.00",
          Netwr: oItem.Netwr || "0.00",
          DeliveryDate: oItem.DeliveryDate,
          ExpectedDeliveryDate: oItem.ExpectedDeliveryDate
        })),
        Remarks: oWorkHeaderData.Remarks || "",
        Additional_Charge_Present: !!oWorkHeaderData.Additional_Charges?.length,
        Additional_Charges: oWorkHeaderData.Additional_Charges?.map(c => ({
          Charge_Name: c.Charge_Name,
          Charge_Price: c.Charge_Price,
          Charge_Unit: c.Charge_Unit || "INR"
        })) || [],
        Additional_Attachment_Present: !!oWorkHeaderData.Additional_Attachments?.length,
        Additional_Attachments: oWorkHeaderData.Additional_Attachments?.map(a => ({
          DOCUMENT_ID: a.DOCUMENT_ID,
          FILE_NAME: a.FILE_NAME,
          DESCRIPTION: a.DESCRIPTION,
          FILE_URL: a.FILE_URL
        })) || []
      };

      return this._createEntity("/ZC_AISP_RFQ_DRAFT", oDraftData);
    },

    _updatePreRequisites: function () {
      const { RfqNumber, Bidder, VendorAccgrp } = this.getView().getModel("oHeaderModel").getProperty("/results/0");
      const aQuestions = this.getView().getModel("oQuestionsModel").getProperty("/questions");
      const aAttachments = this.getView().getModel("oAttachmentsModel").getProperty("/attachments");

      const oPayload = {
        RfqNumber,
        Bidder,
        ACCOUNT_GROUP: VendorAccgrp,
        Responses: aQuestions.map(q => ({ QUESTION_ID: q.QUESTION_ID, RESPONSE_TEXT: q.RESPONSE || "" })),
        Attachments: aAttachments.map(a => ({
          DOCUMENT_ID: a.DOCUMENT_ID,
          FILE_NAME: a.IS_PRESENT ? a.RESPONSE_FILE_NAME : "",
          FILE_URL: a.IS_PRESENT ? a.RESPONSE_FILE_URL : "",
          DESCRIPTION: a.RESPONSE_DESCRIPTION,
          IS_PRESENT: a.IS_PRESENT,
          REASON_FOR_ABSENCE: a.IS_PRESENT ? "" : (a.RESPONSE_REASON_FOR_ABSENCE || "")
        }))
      };

      console.log("Saving Pre-requisites with payload:", oPayload);

      return this._createEntity("/editRFQResponsesAndAttachments", oPayload);
    },

    _updateQuotation: function () {
      // Placeholder for saving quotation data
      const { RfqNumber, Bidder } = this.getView().getModel("oHeaderModel").getProperty("/results/0");
      const aItems = this.getView().getModel("oWorkItemsModel").getProperty("/results");
      const oWorkHeaderData = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");

      const oPayload = {
        RfqNumber,
        Bidder,
        Items: aItems.map(item => ({
          ItemNumber: item.ItemNumber,
          Netpr: item.Netpr,
          Netwr: item.Netwr,
          Quantity: item.Quantity,
          DeliveryDate: item.DeliveryDate,
          ExpectedDeliveryDate: item.ExpectedDeliveryDate
        })),
        Additional_Charge_Present: !!oWorkHeaderData.Additional_Charges?.length,
        Additional_Charges: oWorkHeaderData.Additional_Charges || [],
        Remarks: oWorkHeaderData.Remarks || "",
        Additional_Attachment_Present: !!oWorkHeaderData.Additional_Attachments?.length,
        Additional_Attachments: oWorkHeaderData.Additional_Attachments || []
      };

      return this._createEntity("/EditRFQ", oPayload);
    },

    /* === SUBMISSION STATE MANAGEMENT === */
    _setSubmissionState: function (sState, bIsSubmitting = false) {
      const oUIState = this.getView().getModel("uiState").getData();
      oUIState.submission.state = sState;
      oUIState.submission.isSubmitting = bIsSubmitting;
      this.getView().getModel("uiState").setData(oUIState);
      this.getView().getModel("uiState").refresh(true);
      if (sState === this.CONFIG.SUBMISSION_STATES.PREVIEW) this._scrollToPreview();
    },

    _scrollToPreview: function () {
      const oPage = this.getView().byId("ObjectPageLayout");
      const oPreviewSection = this.getView().byId("previewSection");
      if (oPage && oPreviewSection) oPage.scrollToSection(oPreviewSection.getId());
    },

    /* === MISCELLANEOUS === */
    onRadioButtonSelect: function (oEvent) {
      const selectedIndex = oEvent.getSource().getSelectedIndex();
      this.getView().getModel("oSelectedOptionModel").setProperty("/selectedOption", selectedIndex === 0 ? "Manual" : "Excel Upload");
      if (selectedIndex === 1) {
        const oWorkItemsModel = this.getView().getModel("oWorkItemsModel");
        const aItems = oWorkItemsModel.getProperty("/results");
        aItems.forEach(item => {
          item.Netpr = "";
          item.Netwr = 0;
          item.DeliveryDate = "";
          item.ExpectedDeliveryDate = "";
        });
        oWorkItemsModel.setProperty("/results", aItems);
      }
    },

    onNetPriceChange: function (oEvent) {
      const oSource = oEvent.getSource();
      const oItem = oSource.getBindingContext("oWorkItemsModel").getObject();
      const netPrice = parseFloat(oItem.Netpr);
      if (isNaN(netPrice) || netPrice < 0) {
        oSource.setValueState("Error");
        oSource.setValueStateText("Net Price cannot be negative or empty");
        return;
      }
      oSource.setValueState("None");
      oItem.Netwr = netPrice * parseFloat(oItem.Quantity);
      this.getView().getModel("oWorkItemsModel").setProperty(oSource.getBindingContext("oWorkItemsModel").getPath(), oItem);
      this.calculateTotalValue();
    },

    onDownloadTemplate: function () {
      const { RfqNumber, Bidder } = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");
      this._setBusy(true);

      this.getView().getModel().callFunction("/generateMassUploadExcel", {
        method: "POST",
        urlParameters: { RfqNumber, Bidder },
        success: oData => {
          if (oData.generateMassUploadExcel.fileUrl) {
            sap.m.URLHelper.redirect(oData.generateMassUploadExcel.fileUrl, true);
          } else {
            this._showError("File URL not available");
          }
          this._setBusy(false);
        },
        error: oError => {
          this._showError(oError.message),
            this._setBusy(false);
        }
      });
    },

    onPreReqRadioBtnSelect: function (oEvent) {
      const oSource = oEvent.getSource();
      const selectedText = oSource.getAggregation("buttons")[oEvent.getParameter("selectedIndex")].getText();
      const oContext = oSource.getBindingContext("oQuestionsModel");
      this.getView().getModel("oQuestionsModel").setProperty(`${oContext.getPath()}/RESPONSE`, selectedText);
    },

    // calculateTotalValue: function (aItems, aCharges) {
    //   
    //   if (!aItems || !Array.isArray(aItems) || !aCharges || !Array.isArray(aCharges)) return "0.00";

    //   const fItemsTotal = aItems.reduce((sum, item) => {
    //     const netwr = parseFloat(item.Netwr) || 0;
    //     return sum + netwr;
    //   }, 0);

    //   const fChargesTotal = aCharges.reduce((sum, charge) => {
    //     const price = parseFloat(charge.Charge_Price) || 0;
    //     return sum + price;
    //   }, 0);

    //   const total = (fItemsTotal + fChargesTotal).toFixed(2);
    //   return total;
    // },

    calculateTotalValue: function () {
      const oWorkItemsModel = this.getView().getModel("oWorkItemsModel");
      const oWorkHeaderModel = this.getView().getModel("oWorkHeaderModel");
      const oTotalModel = this.getView().getModel("oTotalModel");
      const aItems = oWorkItemsModel.getProperty("/results") || [];
      const aCharges = oWorkHeaderModel.getProperty("/results/0/Additional_Charges") || [];

      const fItemsTotal = aItems.reduce((sum, item) => {
        const netwr = parseFloat(item.Netwr) || 0;
        return sum + netwr;
      }, 0);

      const fChargesTotal = aCharges.reduce((sum, charge) => {
        const price = parseFloat(charge.Charge_Price) || 0;
        return sum + price;
      }, 0);

      const total = (fItemsTotal + fChargesTotal).toFixed(2);
      oTotalModel.setProperty("/TotalQuotationValue", total);
      oTotalModel.refresh(true); // Ensure UI updates
    },
    /* === EXCEL PROCESSING === */
    onExcelUpload: function (oEvent) {
      const oFile = oEvent.getParameter("files")?.[0];
      if (!oFile) return;
      if (!this._validateExcelFormat(oFile)) {
        this._showError("Invalid Excel file format. Please upload a valid .xlsx or .xls file.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => this._processExcel(reader.result);
      reader.onerror = () => this._showError("Error reading Excel file");
      reader.readAsArrayBuffer(oFile);
    },

    _processExcel: function (fileData) {
      try {
        const workbook = XLSX.read(fileData, { type: "array" });
        const sheetJson = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
        const filteredData = this._filterExcelRows(sheetJson);
        if (!filteredData || filteredData.length === 0) {
          this._showError("File uploaded is not valid");
        }

        const { isValid, invalidRows, validRows } = this._validateExcelData(filteredData);
        if (isValid) {
          this._updateWorkItems(validRows);
          MessageToast.show("Excel data updated successfully");
        } else {
          this._showError(`Invalid rows: ${invalidRows.join(", ")}`);
        }
      } catch (error) {
        this._showError("Invalid Excel file format");
      }
    },

    _filterExcelRows: function (sheetJson) {
      const headers = ["Item No", "Material No - Description", "UOM", "Plant", "Required Quantity", "Net Price - INR", "Total Price", 'Delivery Date (yyyy-mm-dd)', 'Expected Delivery Date (yyyy-mm-dd)'];

      const filteredData = [];
      let isCollecting = false;

      for (const row of sheetJson) {
        if (!row?.length) continue;
        if (row.length === headers.length && row.every((cell, i) => cell === headers[i])) {
          isCollecting = true;
          continue;
        }
        if (isCollecting && row.length === headers.length) filteredData.push(row);
      }
      return filteredData;
    },

    _validateExcelData: function (excelData) {
      const invalidRows = [], validRows = [];

      excelData.forEach((row, index) => {
        const netPrice = row[5], quantity = row[4];
        const deliveryDateSerial = row[7], expectedDeliveryDateSerial = row[8];
        const errors = [];

        // Validate Net Price
        if (isNaN(netPrice) || netPrice < 0) {
          errors.push("Invalid Net Price");
        }

        // Validate Quantity
        if (isNaN(quantity) || quantity < 0) {
          errors.push("Invalid Quantity");
        }

        // Convert Excel serial dates to yyyy-mm-dd format
        let deliveryDate = null;
        let expectedDeliveryDate = null;

        if (deliveryDateSerial && !isNaN(deliveryDateSerial)) {
          deliveryDate = this._excelSerialToDateString(deliveryDateSerial);
          if (!deliveryDate) {
            errors.push("Invalid Delivery Date");
          }
        }

        if (expectedDeliveryDateSerial && !isNaN(expectedDeliveryDateSerial)) {
          expectedDeliveryDate = this._excelSerialToDateString(expectedDeliveryDateSerial);
          if (!expectedDeliveryDate) {
            errors.push("Invalid Expected Delivery Date");
          }
        }

        // Check if dates are not in the past (only if they're valid)
        const now = new Date();
        now.setHours(0, 0, 0, 0); // Reset time to compare dates only

        if (deliveryDate) {
          const deliveryDateObj = new Date(deliveryDate);
          if (deliveryDateObj < now) {
            errors.push("Delivery Date cannot be in the past");
          }
        }

        if (expectedDeliveryDate) {
          const expectedDateObj = new Date(expectedDeliveryDate);
          if (expectedDateObj < now) {
            errors.push("Expected Delivery Date cannot be in the past");
          }
        }

        if (errors.length > 0) {
          invalidRows.push(`Row ${index + 1}: ${errors.join(", ")}`);
        } else {
          validRows.push({
            itemNumber: row[0],
            netPrice: row[5],
            quantity: row[4],
            deliveryDate: deliveryDate,
            expectedDeliveryDate: expectedDeliveryDate
          });
        }
      });

      return { isValid: !invalidRows.length, invalidRows, validRows };
    },

    // Helper function to convert Excel serial number to yyyy-mm-dd string
    _excelSerialToDateString: function (serial) {
      try {
        // Excel serial date: 1 = January 1, 1900
        // JavaScript Date: 0 = January 1, 1970
        const excelEpoch = new Date(1900, 0, 1);
        const jsDate = new Date(excelEpoch.getTime() + (serial - 2) * 24 * 60 * 60 * 1000);

        // Format as yyyy-mm-dd
        const year = jsDate.getFullYear();
        const month = String(jsDate.getMonth() + 1).padStart(2, '0');
        const day = String(jsDate.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;
      } catch (error) {
        console.error("Error converting Excel serial date:", error);
        return null;
      }
    },

    // Helper function to validate date format
    _isValidDate: function (dateString) {
      if (!dateString) return false;

      // Check if it matches yyyy-mm-dd format
      const regex = /^\d{4}-\d{2}-\d{2}$/;
      if (!regex.test(dateString)) return false;

      // Check if it's a valid date
      const date = new Date(dateString);
      return date instanceof Date && !isNaN(date);
    },

    _updateWorkItems: function (validRows) {
      const oWorkItemsModel = this.getView().getModel("oWorkItemsModel");
      const aItems = oWorkItemsModel.getProperty("/results");
      validRows.forEach(row => {
        const oItem = aItems.find(item => item.ItemNumber === row.itemNumber);
        if (oItem) {
          oItem.Netpr = row.netPrice;
          oItem.Netwr = row.netPrice * row.quantity;
          // Update dates if provided
          if (row.deliveryDate) {
            oItem.DeliveryDate = row.deliveryDate;
          }
          if (row.expectedDeliveryDate) {
            oItem.ExpectedDeliveryDate = row.expectedDeliveryDate;
          }
        }
      });
      oWorkItemsModel.setProperty("/results", aItems);
    },

    createColumnConfig: function () {
      const EdmType = library.EdmType;

      return [
        { label: "RFQ Number", property: "RfqNumber", type: EdmType.String },
        { label: "Item Number", property: "ItemNumber", type: EdmType.String },
        { label: "Bidder", property: "Bidder", type: EdmType.String },
        { label: "Material No", property: "MaterialNo", type: EdmType.String },
        { label: "Material Description", property: "MaterialDesc", type: EdmType.String },
        { label: "Lot Type", property: "LotType", type: EdmType.String },
        { label: "Unit of Measure", property: "UnitOfMeasure", type: EdmType.String },
        { label: "Currency", property: "Currency", type: EdmType.String },
        { label: "Plant Address", property: "PlantAddress", type: EdmType.String },
        { label: "Quantity", property: "Quantity", type: EdmType.Number, scale: 2 },
        { label: "Plant", property: "Plant", type: EdmType.String },
        { label: "Net Price", property: "Netpr", type: EdmType.Number, scale: 2 },
        { label: "Net Worth", property: "Netwr", type: EdmType.Number, scale: 2 },
        { label: "Long Text", property: "basic_longtext", type: EdmType.String },
        { label: "Delivery Date", property: "DeliveryDate", type: EdmType.String },
        { label: "Expected Delivery Date", property: "ExpectedDeliveryDate", type: EdmType.String },
      ];
    },

    onExcelExport: function (oEvent) {
      const oTable = this.getView().byId("rfqEventsTable");
      const oRowBinding = oTable.getBinding("items");
      const aCols = this.createColumnConfig();

      const oSettings = {
        workbook: {
          columns: aCols,
          hierarchyLevel: "Level"
        },
        dataSource: oRowBinding,
        fileName: "Table export sample.xlsx",
        worker: false // We need to disable worker because we are using a MockServer as OData Service
      };

      const oSheet = new Spreadsheet(oSettings);

      oSheet.build().finally(function () {
        oSheet.destroy();
      });
    },

    onPDFExport: function () {
      const oTable = this.byId("rfqEventsTable");

      const oExportSettings = {
        workbook: {
          columns: [
            { label: "S.No", property: "ItemNumber" },
            { label: "Material Code", property: "MaterialNo" },
            { label: "Description", property: "MaterialDesc" },
            { label: "Quantity", property: "Quantity" },
            { label: "Specification", property: "basic_longtext" }
          ]
        },
        dataSource: {
          type: "binding",
          model: this.getView().getModel("oItemsModel"),  // Ensure model is set correctly
          path: "/results"  // Path to your data
        },
        fileName: "RFQ_Export.pdf"
      };

      let oExportHandler = new ExportHandler(oTable);

      // Trigger the export
      oExportHandler.export("pdf", oExportSettings).then(function () {
        console.log("PDF Export completed successfully.");
      }).catch(function (error) {
        console.error("Export failed:", error);
      });
    },

    // onPDFExport: function () {
    //   const oTable = this.byId("rfqEventsTable");
    //   const oRowBinding = oTable.getBinding("items");
    //   const aCols = this.createColumnConfig();
    //   let oExportHandler = new ExportHandler(oTable);

    //   oExportHandler.export("pdf", {
    //     workbook: {
    //       columns: aCols
    //     },
    //     dataSource: {
    //       type: "binding",
    //       model: this.getView().getModel("oItemsModel"),
    //       path: "/results"
    //     },
    //     fileName: "RFQ_Events.pdf"
    //   });
    // },

    /* === ADDITIONAL CHARGES === */
    onAddAdditionalCharges: function () {
      if (!this._oAddChargeDialog) {
        Fragment.load({
          id: this.getView().getId(),
          name: "com.aisp.rfq.fragments.AddChargeDialog",
          controller: this
        }).then(oDialog => {
          this._oAddChargeDialog = oDialog;
          this.getView().addDependent(oDialog);
          oDialog.open();
          this._resetChargeInputs();
        }).catch(error => this._showError(`Failed to load dialog: ${error.message}`));
      } else {
        this._oAddChargeDialog.open();
        this._resetChargeInputs();
      }
    },

    _resetChargeInputs: function () {
      const viewId = this.getView().getId();
      sap.ui.getCore().byId(viewId + "--chargeNameInput")?.setValue("");
      sap.ui.getCore().byId(viewId + "--priceInput")?.setValue("");
    },

    onSaveCharge: function () {
      const viewId = this.getView().getId();
      const sChargeName = sap.ui.getCore().byId(viewId + "--chargeNameInput").getValue().trim();
      const sPrice = sap.ui.getCore().byId(viewId + "--priceInput").getValue().trim();
      if (!sChargeName || isNaN(sPrice) || sPrice < 0) {
        this._showError("Enter a valid charge name and non-negative price");
        return;
      }

      const oWorkHeaderModel = this.getView().getModel("oWorkHeaderModel");
      const oData = oWorkHeaderModel.getProperty("/results/0");
      oData.Additional_Charges = oData.Additional_Charges || [];
      oData.Additional_Charges.push({
        Charge_Name: sChargeName,
        Charge_Price: parseFloat(sPrice),
        Charge_Unit: oData.PriceUnit || "INR"
      });
      oWorkHeaderModel.setProperty("/results/0", oData);
      this.calculateTotalValue();
      this._oAddChargeDialog.close();
    },

    onCancelCharge: function () {
      this._resetChargeInputs();
      this._oAddChargeDialog.close();
    },

    onDeleteCharges: function () {
      const oTable = this.getView().byId("chargesTable");
      const aSelectedContexts = oTable.getSelectedContexts();
      if (!aSelectedContexts.length) {
        MessageToast.show("Select at least one charge to delete");
        return;
      }

      this._showConfirm("Are you sure you want to delete the selected charges?", {
        title: "Confirm Delete Charges",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            const oWorkHeaderModel = this.getView().getModel("oWorkHeaderModel");
            const oData = oWorkHeaderModel.getProperty("/results/0");
            oData.Additional_Charges = oData.Additional_Charges.filter((_, index) =>
              !aSelectedContexts.some(ctx => ctx.getPath().includes(`/results/0/Additional_Charges/${index}`))
            );
            oWorkHeaderModel.setProperty("/results/0", oData);
            oTable.removeSelections(true);
            MessageToast.show("Charges deleted successfully.");
          }
        },
        onCancel: () => console.log("Cancelled")
      });
    },

    /* === ATTACHMENT HANDLING === */
    onUploadChange: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("oAttachmentsModel");
      const oAttachment = oContext.getObject();
      const oFile = oEvent.getParameter("files")?.[0];

      if (!oFile) {
        this._showError("No file selected");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        oAttachment.RESPONSE_FILE_NAME = oFile.name;
        oAttachment.RESPONSE_FILE_URL = reader.result.split(',')[1];
        oAttachment.IS_PRESENT = true;
        oAttachment.RESPONSE_REASON_FOR_ABSENCE = "";
        this.getView().getModel("oAttachmentsModel").setProperty(oContext.getPath(), oAttachment);
        this.getView().getModel("oAttachmentsModel").refresh(true);
        MessageToast.show("File uploaded successfully");
      };
      reader.onerror = () => this._showError("Failed to read file");
      reader.readAsDataURL(oFile);
    },

    onPreviewAttachment: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("oAttachmentsModel");
      const sFileUrl = oContext.getProperty("RESPONSE_FILE_URL");
      const sFileName = oContext.getProperty("RESPONSE_FILE_NAME");

      if (!sFileUrl) {
        this._showError("No file available for preview");
        return;
      }

      try {
        const isBase64 = /^[A-Za-z0-9+/=]+$/.test(sFileUrl) && sFileUrl.length > 100;
        const mimeType = this._getMimeType(sFileName?.split('.').pop()?.toLowerCase() || "");

        if (isBase64) {
          // Handle base64 data
          const byteCharacters = atob(sFileUrl);
          const byteArray = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteArray[i] = byteCharacters.charCodeAt(i);
          }
          const blob = new Blob([byteArray], { type: mimeType || "application/octet-stream" });
          window.open(URL.createObjectURL(blob), "_blank");
        } else {
          // Handle blob URL or direct URL
          const link = document.createElement("a");
          link.href = sFileUrl;
          link.target = "_blank";
          if (mimeType) {
            link.type = mimeType;
          }
          link.click();
        }
      } catch (error) {
        this._showError("Failed to preview file: " + error.message);
      }
    },

    onDeleteAttachment: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("oAttachmentsModel");
      const oAttachment = oContext.getObject();

      this._showConfirm("Are you sure you want to delete this attachment?", {
        title: "Confirm Delete Attachment",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            oAttachment.RESPONSE_FILE_NAME = "";
            oAttachment.RESPONSE_FILE_URL = "";
            oAttachment.IS_PRESENT = false;
            oAttachment.RESPONSE_REASON_FOR_ABSENCE = "";
            this.getView().getModel("oAttachmentsModel").setProperty(oContext.getPath(), oAttachment);
            this.getView().getModel("oAttachmentsModel").refresh(true);

            // Reset FileUploader
            const oFileUploader = oEvent.getSource().getParent().getParent().getItems()[1].getItems()[1]; // Navigate to FileUploader
            if (oFileUploader) {
              oFileUploader.setValue("");
              oFileUploader.clear();
            }

            MessageToast.show("Attachment deleted successfully.");
          }
        },
        onCancel: () => console.log("Cancelled")
      });
    },

    onFileSizeExceed: function () {
      this._showError("File size exceeds the maximum limit of 3 MB.");
      return;
    },

    onFileSelected: function (oEvent) {
      const oFile = oEvent.getParameter("files")?.[0];

      if (!oFile) {
        this._showError("No file selected");
        return;
      }

      const maxSize = 3 * 1024 * 1024;

      if (oFile.size > maxSize) {
        this._showError("File size exceeds 3 MB limit");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const oWorkHeaderModel = this.getView().getModel("oWorkHeaderModel");
        const oData = oWorkHeaderModel.getProperty("/results/0");
        oData.Additional_Attachments = oData.Additional_Attachments || [];
        oData.Additional_Attachments.push({
          DOCUMENT_ID: "D" + (oData.Additional_Attachments.length + 1),
          FILE_NAME: oFile.name,
          DESCRIPTION: "",
          FILE_URL: reader.result.split(',')[1]
        });
        oWorkHeaderModel.setProperty("/results/0", oData);
        MessageToast.show("File uploaded successfully");
      };
      reader.onerror = () => this._showError("Failed to read file");
      reader.readAsDataURL(oFile);
    },

    onPreviewAdditionalAttachment: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("oWorkHeaderModel");
      const sFileUrl = oContext.getProperty("FILE_URL");
      const sFileName = oContext.getProperty("FILE_NAME");

      if (!sFileUrl) {
        this._showError("No file available for preview");
        return;
      }

      try {
        const isBase64 = /^[A-Za-z0-9+/=]+$/.test(sFileUrl) && sFileUrl.length > 100;
        const mimeType = this._getMimeType(sFileName?.split('.').pop()?.toLowerCase() || "");

        if (isBase64) {
          const byteCharacters = atob(sFileUrl);
          const byteArray = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteArray[i] = byteCharacters.charCodeAt(i);
          }
          const blob = new Blob([byteArray], { type: mimeType || "application/octet-stream" });
          window.open(URL.createObjectURL(blob), "_blank");
        } else {
          window.open(sFileUrl, "_blank");
        }
      } catch (error) {
        this._showError("Failed to preview file");
      }
    },

    onDeleteAdditionalAttachmentPress: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("oWorkHeaderModel");
      const sPath = oContext.getPath();
      const oWorkHeaderModel = this.getView().getModel("oWorkHeaderModel");
      const oData = oWorkHeaderModel.getProperty("/results/0");
      const iIndex = parseInt(sPath.split("/").pop());

      this._showConfirm("Are you sure you want to delete this additional attachment?", {
        title: "Confirm Delete Additional Attachment",
        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
        onConfirm: (sAction) => {
          if (sAction === MessageBox.Action.YES) {
            oData.Additional_Attachments.splice(iIndex, 1);
            oWorkHeaderModel.setProperty("/results/0", oData);
            MessageToast.show("Additional attachment deleted successfully.");
          }
        },
        onCancel: () => console.log("Cancelled")
      });
    },

    onAttachmentPreview: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("oWorkHeaderModel");
      const sFileUrl = oContext.getProperty("FILE_URL");
      const sFileName = oContext.getProperty("FILE_NAME");

      if (!sFileUrl) {
        this._showError("No file available for preview");
        return;
      }

      try {
        const isBase64 = /^[A-Za-z0-9+/=]+$/.test(sFileUrl) && sFileUrl.length > 100;
        const mimeType = this._getMimeType(sFileName?.split('.').pop()?.toLowerCase() || "");

        if (isBase64) {
          const byteCharacters = atob(sFileUrl);
          const byteArray = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteArray[i] = byteCharacters.charCodeAt(i);
          }
          const blob = new Blob([byteArray], { type: mimeType || "application/octet-stream" });
          window.open(URL.createObjectURL(blob), "_blank");
        } else {
          const link = document.createElement("a");
          link.href = sFileUrl;
          link.target = "_blank";
          if (mimeType) {
            link.type = mimeType;
          }
          link.click();
        }
      } catch (error) {
        this._showError("Failed to preview file: " + error.message);
      }
    },

    /* === FORMATTER FUNCTIONS === */
    formatDateTime: function (datePart, timePart) {
      if (!datePart) return "";
      try {
        const dateObj = new Date(datePart);
        if (timePart && typeof timePart === 'string' && timePart.includes(':')) {
          const [hours, minutes] = timePart.split(':');
          dateObj.setHours(parseInt(hours, 10));
          dateObj.setMinutes(parseInt(minutes, 10));
        }
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        let hours = dateObj.getHours();
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${day}-${month}-${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
      } catch (e) {
        console.error("Date formatting error:", e);
        return datePart || "";
      }
    },

    formatDate: function (sDate) {
      if (!sDate) return "";
      return sap.ui.core.format.DateFormat.getDateInstance({ pattern: "dd-MM-yyyy" }).format(new Date(sDate));
    },

    // Add this formatter function
    formatSAPDate: function (sapDateString) {
      if (!sapDateString) return null;

      if (sapDateString.startsWith("/Date(")) {
        const timestampMatch = sapDateString.match(/\/Date\((\d+)\)\//);
        if (timestampMatch && timestampMatch[1]) {
          const timestamp = parseInt(timestampMatch[1]);
          return new Date(timestamp);
        }
      }
      return sapDateString; // Return as-is if not in SAP format
    },

    formatStatusState: function (sStatus) {
      const mStatusStates = {
        [this.CONFIG.STATUS.PENDING]: "Indication13",
        [this.CONFIG.STATUS.SUBMITTED]: "Indication14",
        [this.CONFIG.STATUS.AWARDED]: "Indication18",
        [this.CONFIG.STATUS.ACCEPTED]: "Indication15",
        [this.CONFIG.STATUS.NOT_ACCEPTED]: "Indication10",
        [this.CONFIG.STATUS.REJECTED]: "Indication11",
        [this.CONFIG.STATUS.DRAFT]: "Indication16"
      };
      return mStatusStates[sStatus] || "None";
    },

    /* === UTILITY METHODS === */
    onSearchRFQEvents: function (oEvent) {
      const sQuery = oEvent.getParameter("query");
      MessageToast.show(`Search triggered with query: ${sQuery}`);
    },

    _setBusy: function (bBusy) {
      this.getView().setBusy(bBusy);
    },

    _showConfirm: function (sMessage, oOptions = {}) {
      MessageBox.confirm(sMessage, {
        title: oOptions.title || "Confirm",
        actions: oOptions.actions || [MessageBox.Action.YES, MessageBox.Action.NO],
        onClose: function (sAction) {
          console.log("MessageBox closed with action:", sAction);
          if (sAction === (oOptions.actions?.[0] || MessageBox.Action.YES)) {
            console.log("Confirm action triggered");
            oOptions.onConfirm?.(sAction);
          } else {
            console.log("Cancel action triggered");
            oOptions.onCancel?.();
          }
        },
        styleClass: oOptions.styleClass || ""
      });
    },

    _showSuccess: function (sMessage = "Operation completed successfully.", oOptions = {}) {
      const {
        title = "Success",
        actions = [MessageBox.Action.OK],
        onClose,
      } = oOptions;

      MessageBox.success(sMessage, {
        title,
        actions,
        onClose,
      });
    },

    _showError: function (sMessage = "Something went wrong, Please Try Again After Sometime", oOptions = {}) {
      const {
        title = "Error",
        actions = [MessageBox.Action.OK],
        onClose,
      } = oOptions;

      MessageBox.error(sMessage, {
        title,
        actions,
        onClose
      });
    },

    _showToast: function (sMessage, oOptions = {}) {
      MessageToast.show(sMessage, {
        duration: oOptions.duration || 3000,
        width: oOptions.width || "15em",
        my: oOptions.my || "center center",
        at: oOptions.at || "center center",
        of: oOptions.of || window,
        offset: oOptions.offset || "0 0",
        collision: oOptions.collision || "fit fit"
      });
    },

    _navigateToList: function () {
      const oView = this.getView();
      const oRouter = this.getOwnerComponent().getRouter();

      oView.setBusy(true);
      oRouter.navTo("RouteRFQList");

      oRouter.getRoute("RouteRFQList").attachPatternMatched(() => {
        oView.setBusy(false);
      }, null, { once: true });
    },

    onExit: function () {
      if (this._countdownInterval) clearInterval(this._countdownInterval);
      if (this._oRejectDialog) this._oRejectDialog.destroy();
      if (this._oAddChargeDialog) this._oAddChargeDialog.destroy();

      // Reset submission state so next time controller is reused it doesn't keep preview/submitting
      const oUIStateModel = this.getView().getModel("uiState");
      if (oUIStateModel) {
        const oUIState = oUIStateModel.getData();
        oUIState.submission.state = this.CONFIG.SUBMISSION_STATES.CREATING;
        oUIState.submission.isSubmitting = false;
        oUIStateModel.setData(oUIState);
        oUIStateModel.refresh(true);
      }
    },

    /* === CHATBOT METHODS === */

    onChatButtonPress: function (oEvent) {
      var oButton = oEvent.getSource(),
        oView = this.getView();

      if (!this._oPopover) {
        Fragment.load({
          id: oView.getId(),
          name: "com.aisp.rfq.fragments.Notification",
          controller: this,
        }).then(
          function (oPopover) {
            oView.addDependent(oPopover);
            this._oPopover = oPopover;

            this._oPopover.openBy(oButton);
          }.bind(this)
        );
      } else {
        this._oPopover.openBy(oButton);
        const oWorkHeaderData = this.getView()
          .getModel("oItemsModel")
          .getData();
        console.log(oWorkHeaderData);
      }
    },

    closePopover: function () {
      if (this._oPopover) {
        this._oPopover.close();
      }
    },

    getMaterialsName: function (rfq, bidder) {
      let oModel = this.getOwnerComponent().getModel();
      let oJSONModel = new sap.ui.model.json.JSONModel();
      let sPath = "/ZC_AISP_RFQ_ITEM";
      let oFilters = [
        new sap.ui.model.Filter("RfqNumber", sap.ui.model.FilterOperator.EQ, rfq),
        new sap.ui.model.Filter("Bidder", sap.ui.model.FilterOperator.EQ, bidder),
      ];

      oModel.read(sPath, {
        filters: oFilters,
        success: function (oData) {
          // Prepare data object with results and empty Negotiation property
          const formattedData = {
            results: oData.results,
            Negotiation: []
          };
          oJSONModel.setData(formattedData);
          this.getView().setModel(oJSONModel, "rfqItemsData");
        }.bind(this),
        error: function (oError) {
          // Handle error
        }
      });
    },

    onStandardListItemPress: async function (oEvent) {
      debugger;
      const selectedMaterial = oEvent
        .getSource()
        .getBindingContext("rfqItemsData")
        .getObject().MaterialNo;
      this.mat = selectedMaterial;
      // this.getView().getModel(
      //   "rfqItemsData"
      // ).oData.Negotiation[0].materialNo = "m1";

      // console.log(
      //   this.getView().getModel("rfqItemsData").oData.Negotiation[0]
      //     .materialNo
      // );

      await this.onUpdateNegotiationData(selectedMaterial);

      const messageStrip = this.getView()
        .byId("idNegotiationList")
        .getItems()[0].mAggregations.content[1].mAggregations.items[0];

      const modelData = this.getView()
        .getModel("rfqItemsData")
        .getProperty("/Negotiation/0");

      if (modelData.expectedPrice) {
        messageStrip.setText = `Buyer is expecting ${modelData.expectedPrice} Rs`;
      } else {
        messageStrip.setTex = `Buyer wants to know your best offer.`;
      }

      var oNavContainer = this.byId("idNavContainer");
      console.log(oNavContainer);
      var oPage = this.byId("chatPageID");
      console.log(oPage);

      const roomInfo = `supplierId-rfqNum-matNum`;
      this.socket.send(
        JSON.stringify({
          type: "register",
          roomInfo,
        })
      );

      // Navigate to the page inside the NavContainer
      oNavContainer.to(oPage);
      this.byId("toolPopover").addAriaDescribedBy(this.byId("chatPageID"));
      this.byId("toolPopover").focus();
    },

    onUpdateNegotiationData: async function (selectedMaterial) {
      // Get a reference to your JSON model
      const oModel = this.getView().getModel("rfqItemsData");

      // Optional: Show a busy indicator while fetching data
      this.getView().setBusy(true);

      try {
        // Fetch the new data using the helper function that calls the /latest API
        const oLatestRecord = await this._getNewNegotiationData(selectedMaterial);

        if (oLatestRecord) {
          // Get the current Negotiation array
          const aNegotiationData = oModel.getProperty("/Negotiation/0");
          console.log(aNegotiationData);
          // Find the index of the object that matches the fetched record's properties
          // const iIndex = aNegotiationData.findIndex(
          //   (item) =>
          //     item.buyerId === oLatestRecord.buyerId &&
          //     item.supplierId === oLatestRecord.supplierId &&
          //     item.rfqNumber === oLatestRecord.rfqNumber &&
          //     item.materialNo === oLatestRecord.materialNo
          // );

          //   console.log(iIndex)

          // if (iIndex !== -1) {
          //   // If a matching record is found, update it in place
          //   aNegotiationData[0] = oLatestRecord;
          // }
          // Update the entire array in the model, triggering UI rerendering
          oModel.setProperty("/Negotiation/0", oLatestRecord);

          console.log(oModel.getProperty("/Negotiation/0"));

          sap.m.MessageToast.show("Negotiation data updated successfully!");
        } else {
          sap.m.MessageToast.show("No new data to update.");
        }
      } catch (error) {
        sap.m.MessageToast.show("Failed to update data: " + error.message);
      } finally {
        this.getView().setBusy(false);
      }
    },

    _getNewNegotiationData: async function (selectedMaterial) {
      const sBuyerId = "b1"; // Replace with dynamic value from your UI
      // const sSupplierId = this.Bidder; // Replace with dynamic value from your UI
      // const sRfqNumber = this.rfqNumber; // Replace with dynamic value from your UI
      // const sMaterialNo = this.mat; // Replace with dynamic value from your UI

      const sUrl = `https://chat_micro_service.cfapps.ap10.hana.ondemand.com/api/chat/latest?buyerId=${sBuyerId}&supplierId=${this.Bidder}&rfqNumber=${this.rfqNumber}&materialNo=${selectedMaterial}`;

      try {
        const response = await fetch(sUrl);
        const data = await response.json();

        if (data.success) {
          debugger;
          // The API returns a single message object under the 'message' key
          return data.message;
        } else {
          console.error("API error:", data.error);
          return null;
        }
      } catch (error) {
        console.error("Fetch error:", error);
        throw new Error("Could not connect to the backend.");
      }
    },

    initialiseSocket: function () {
      this.socket = new WebSocket("wss://chat_micro_service.cfapps.ap10.hana.ondemand.com:8080");
      this.socket.attachMessage(
        async function (oEvent) {
          // This function will be called automatically when a message arrives

          var sMessage = oEvent.getParameter("data");
          console.log("Received a message: " + sMessage);
          //  await this.onUpdateNegotiationData();
        }.bind(this)
      );
    },

    onBestOfferButtonPress: async function (oEvent) {
      // Get the required data from UI elements

      var oButton = oEvent.getSource();
      if (!this._oBestOfferPopover) {
        Fragment.load({
          id: this.getView().getId(),
          name: "com.aisp.rfq.fragments.Bestoffer",
          controller: this,
        }).then(
          function (oPopover) {
            this._oBestOfferPopover = oPopover;
            this.getView().addDependent(this._oBestOfferPopover);
            this._oBestOfferPopover.openBy(oButton);
          }.bind(this)
        );
      } else {
        this._oBestOfferPopover.openBy(oButton);
      }
    },

    onRejectButtonPress: async function (oEvent) {
      this.getView().setBusy(true);

      try {
        // 1. Get the message ID from the selected item's data
        const oButton = oEvent.getSource();
        const oBindingContext = oButton.getBindingContext("toolTipModel");
        const oData = oBindingContext.getObject();
        const messageId = oData._id; // Assuming your message object has an _id field

        // 2. Prepare the fetch options
        const sUrl = "https://chat_micro_service.cfapps.ap10.hana.ondemand.com/api/chat/seller/reject"; // The relative path to your backend endpoint
        const oFetchOptions = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messageId: messageId,
          }),
        };

        // 3. Send the request and wait for the response
        const response = await fetch(sUrl, oFetchOptions);
        const data = await response.json();

        // 4. Handle the response
        if (data.success) {
          // Success: Show a message and potentially update the model
          sap.m.MessageToast.show("Price rejected successfully!");
          // You can refresh your model here to get the updated status
          this.getView().getModel("toolTipModel").refresh();
        } else {
          // Error: Show the error message from the backend
          sap.m.MessageToast.show("Failed to reject price: " + data.error);
        }
      } catch (error) {
        // Handle network or other unexpected errors
        sap.m.MessageToast.show("An error occurred: " + error.message);
      } finally {
        // Hide the busy indicator
        this.getView().setBusy(false);
      }
    },

    onAcceptPriceButtonPress: async function (oEVent) {
      this.getView().setBusy(true);

      try {
        // 1. Get the message ID from the selected item's data
        const oButton = oEvent.getSource();
        const oBindingContext = oButton.getBindingContext("toolTipModel");
        const oData = oBindingContext.getObject();
        const messageId = oData._id; // Assuming your message object has an _id field

        // 2. Check if a message ID exists before proceeding
        if (!messageId) {
          sap.m.MessageToast.show("Error: No message ID found.");
          return;
        }

        // 3. Prepare the fetch options for the POST request
        const sUrl = "https://chat_micro_service.cfapps.ap10.hana.ondemand.com/api/chat/seller/accept";
        const oFetchOptions = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messageId: messageId,
          }),
        };

        // 4. Send the request and handle the response
        const response = await fetch(sUrl, oFetchOptions);
        const data = await response.json();

        // 5. Process the backend's response
        if (data.success) {
          sap.m.MessageToast.show("Price accepted successfully! 🎉");
          // Automatically refresh the JSON model to reflect the status change
          //this.getView().getModel("toolTipModel").refresh();
        } else {
          sap.m.MessageToast.show("Failed to accept price: " + data.error);
        }
      } catch (error) {
        // Handle network or other unexpected errors
        sap.m.MessageToast.show("An error occurred: " + error.message);
      } finally {
        // Hide the busy indicator, regardless of success or failure
        this.getView().setBusy(false);
      }
    },

    onSendPress: async function () {
      const sBuyerId = "b1";
      const sSupplierId = this.Bidder;
      const sRfqNumber = this.rfqNumber;
      const sMaterialNo = this.mat;
      const sBestOffer = this.getView().byId("bestPriceInput").getValue();

      // Validate if the input fields are filled
      if (
        !sBuyerId ||
        !sSupplierId ||
        !sRfqNumber ||
        !sMaterialNo ||
        !sBestOffer
      ) {
        sap.m.MessageToast.show("Please fill in all required fields.");
        return;
      }

      // Prepare the data to be sent in the request body
      const oPayload = {
        buyerId: sBuyerId,
        supplierId: sSupplierId,
        rfqNumber: sRfqNumber,
        materialNo: sMaterialNo,
        bestOffer: sBestOffer,
      };

      // Show a busy indicator
      this.getView().setBusy(true);

      try {
        const response = await fetch(
          "https://chat_micro_service.cfapps.ap10.hana.ondemand.com/api/chat/seller/best-offer",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(oPayload),
          }
        );

        const data = await response.json();

        if (data.success) {
          const to = "buyerId-rfqNum-matNum";
          const message = "best offer sent";
          this.socket.send(JSON.stringify({ type: "Dm", to, message }));
          sap.m.MessageToast.show("Best offer submitted successfully!");
          // Refresh the messages list to show the new offer
        } else {
          sap.m.MessageToast.show(
            data.error || "Failed to submit best offer."
          );
        }
      } catch (error) {
        sap.m.MessageToast.show("An error occurred: " + error.message);
      } finally {
        this.getView().setBusy(false);
      }
    },

    onGoBackPress: function (oEvent) {
      const oNavContainer = this.byId("idNavContainer");
      var oFirstPage = this.byId("master");
      oNavContainer.to(oFirstPage);
    },
  });
});