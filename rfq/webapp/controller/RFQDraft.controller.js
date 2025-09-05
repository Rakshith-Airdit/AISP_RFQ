sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/ui/core/format/DateFormat"
], function (
    Controller,
    Filter,
    FilterOperator,
    JSONModel,
    MessageBox,
    MessageToast,
    Fragment,
    DateFormat
) {
    "use strict";

    return Controller.extend("com.aisp.rfq.controller.RFQDraft", {
        // Constants
        MAX_FILE_SIZE_MB: 3,
        COUNTDOWN_INTERVAL: 1000,
        STATUS: {
            DRAFT: "Draft",
            SUBMITTED: "Submitted"
        },
        SUBMISSION_STATES: {
            EDITING: "editing",
            PREVIEW: "preview",
            SUBMITTING: "submitting"
        },
        MAX_PREVIEW_SIZE_MB: 5,
        PREVIEWABLE_TYPES: ["image/jpeg", "image/png", "image/gif", "application/pdf", "text/plain"],
        _isEdited: false,

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
            return mMimeTypes[sExtension.toLowerCase()] || "";
        },

        /************************************
         * INITIALIZATION METHODS
         ************************************/
        onInit: function () {
            this._initModels();
            this._initRouter();
        },

        _initModels: function () {
            // Data Models
            this._initDataModels();

            // Countdown Model
            this._initCountdownModel();
        },

        _initUIStateModel: function () {
            const oUIState = {
                sections: {
                    eventOverview: { visible: true, enabled: true },
                    preRequisite: { visible: true, enabled: true },
                    createQuotation: { visible: true, enabled: true },
                    preview: { visible: false }
                },
                buttons: {
                    confirm: { visible: true, enabled: true },
                    submit: { visible: false, enabled: false },
                    draft: { visible: true, enabled: true },
                    finalSubmit: { visible: false, enabled: false },
                    finalDraft: { visible: false, enabled: false },
                    addCharge: { visible: false, enabled: false },
                    deleteCharge: { visible: false, enabled: false },
                    revisePreRequisite: { visible: true, enabled: true },
                    reviseQuotation: { visible: true, enabled: true },
                    updatePreRequisite: { visible: false, enabled: false },
                    updateQuotation: { visible: false, enabled: false }
                },
                submission: { state: this.SUBMISSION_STATES.PREVIEW, isSubmitting: false }
            };
            this.getView().setModel(new JSONModel(oUIState), "uiState");
        },

        _initDataModels: function () {
            this._initModel("oWorkHeaderModel", { results: [] });
            this._initModel("oWorkItemsModel", { results: [] });
            this._initModel("oQuestionsModel", { questions: [] });
            this._initModel("oAttachmentsModel", { attachments: [] });
            this._initModel("oSelectedOptionModel", { selectedOption: "Manual" });
        },

        _initModel: function (sName, oData) {
            const oModel = new JSONModel(oData);
            this.getView().setModel(oModel, sName);
            return oModel;
        },

        _initCountdownModel: function () {
            this._initModel("oCountdownModel", {
                days: "--",
                hours: "--",
                mins: "--",
                secs: "--"
            });
        },

        _initRouter: function () {
            this.getOwnerComponent().getRouter()
                .getRoute("RouteRFQDraft")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: async function (oEvent) {
            // UI State Model
            this._initUIStateModel();

            this._setBusy(true);
            const { rfqNum, bidder } = oEvent.getParameter("arguments");

            if (!rfqNum || !bidder) {
                MessageToast.show("Invalid RFQ or Bidder ID");
                this._navigateToList();
                return;
            }

            try {
                await this._loadInitialData(rfqNum, bidder);
                const oWorkHeaderData = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");
                if (oWorkHeaderData.Status !== this.STATUS.DRAFT) {
                    this._showError("This RFQ is not in Draft status");
                    this._navigateToList();
                    return;
                }
                this._startCountdown(oWorkHeaderData.Deadline_dt);
                this._updateUIState(oWorkHeaderData.Status);
            } catch (oError) {
                MessageToast.show(`Failed to load data: ${oError.message}`);
                console.error(oError);
            } finally {
                this._setBusy(false);
            }
        },

        /************************************
         * COUNTDOWN TIMER
         ************************************/

        _startCountdown: function (sDeadline) {
            if (!sDeadline) return;
            const oDeadline = new Date(sDeadline);

            if (isNaN(oDeadline)) {
                this._showError("Invalid deadline date for countdown");
                return;
            }

            if (this._countdownInterval) clearInterval(this._countdownInterval);
            this._updateCountdown(oDeadline);
            this._countdownInterval = setInterval(() => this._updateCountdown(oDeadline), this.COUNTDOWN_INTERVAL);
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

        /************************************
         * DATA LOADING
         ************************************/
        _loadInitialData: async function (rfqNum, bidder) {

            let aFilters = [
                new Filter("RfqNumber", FilterOperator.EQ, rfqNum),
                new Filter("Bidder", FilterOperator.EQ, bidder)
            ];

            await Promise.all([
                this._loadEntity("/ZC_AISP_RFQ_WORK_HDR", aFilters, "oWorkHeaderModel"),
                this._loadEntity("/ZC_AISP_RFQ_WORK_ITEM", aFilters, "oWorkItemsModel")
            ]);

            const oWorkHeaderData = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");
            const oWorkItemData = this.getView().getModel("oWorkItemsModel").getProperty("/results");

            if (oWorkItemData) {
                this._convertISOToDate(oWorkItemData, this.getView().getModel("oWorkItemsModel"))
            }

            await this._loadDynamicSections(oWorkHeaderData.VendorAccgrp, rfqNum, bidder);
        },

        _loadDynamicSections: async function (accountGroup, rfqNum, bidder) {
            const errors = [];
            await Promise.all([
                this._loadQuestionsSection(accountGroup, rfqNum, bidder).catch(error => errors.push(error.message || "Failed to load questions")),
                this._loadAttachmentsSection(accountGroup, rfqNum, bidder).catch(error => errors.push(error.message || "Failed to load attachments"))
            ]);

            if (errors.length > 0) {
                const errorMessage = errors.length === 2
                    ? "No pre-requisite questions or attachments defined by admin"
                    : errors[0];
                this._showError(errorMessage);
            }
        },

        _loadQuestionsSection: async function (accountGroup, rfqNum, bidder) {
            const oQuestionsModel = this.getView().getModel("oQuestionsModel");
            let aFilters = [new Filter("ACCOUNT_GROUP", FilterOperator.EQ, accountGroup)]
            const questions = await this._fetchEntity("/SupplierPreReqQstns", aFilters);

            if (!questions?.length) {
                oQuestionsModel.setProperty("/questions", []);
                throw new Error("No pre-requisite questions defined by admin");
            }

            const initializedQuestions = questions.map(q => ({ ...q, RESPONSE: q.RESPONSE || "Yes" }));
            await this._fetchPreviousResponses(rfqNum, bidder, accountGroup, initializedQuestions);
            oQuestionsModel.setProperty("/questions", initializedQuestions);
        },

        _loadAttachmentsSection: async function (accountGroup, rfqNum, bidder) {
            const oAttachmentsModel = this.getView().getModel("oAttachmentsModel");
            let aFilters = [new Filter("ACCOUNT_GROUP", FilterOperator.EQ, accountGroup)]

            const attachments = await this._fetchEntity("/SupplierPreReqAttchmnts", aFilters);

            if (!attachments?.length) {
                oAttachmentsModel.setProperty("/attachments", []);
                throw new Error("No pre-requisite attachments defined by admin");
            }

            const initializedAttachments = attachments.map(a => ({
                ...a,
                RESPONSE_DESCRIPTION: a.RESPONSE_DESCRIPTION || "",
                RESPONSE_FILE_NAME: a.RESPONSE_FILE_NAME || "",
                RESPONSE_FILE_URL: a.RESPONSE_FILE_URL || "",
                RESPONSE_REASON_FOR_ABSENCE: a.RESPONSE_REASON_FOR_ABSENCE || "",
                IS_PRESENT: !!a.RESPONSE_FILE_URL
            }));

            await this._fetchPreviousAttachments(rfqNum, bidder, accountGroup, initializedAttachments);
            oAttachmentsModel.setProperty("/attachments", initializedAttachments);
        },

        _fetchPreviousResponses: async function (rfqNum, bidder, accountGroup, questions) {
            let aFilters = [
                new Filter("RfqNumber", FilterOperator.EQ, rfqNum),
                new Filter("Bidder", FilterOperator.EQ, bidder),
                new Filter("ACCOUNT_GROUP", FilterOperator.EQ, accountGroup)
            ];
            const responseData = await this._fetchEntity("/SupplierResponses", aFilters);
            const previousResponses = responseData?.[0]?.RESPONSES || [];
            questions.forEach(q => {
                const prevResponse = previousResponses.find(r => r.QUESTION_ID === q.QUESTION_ID);
                q.RESPONSE = prevResponse?.RESPONSE_TEXT || q.RESPONSE || "Yes";
            });
        },

        _fetchPreviousAttachments: async function (rfqNum, bidder, accountGroup, attachments) {
            const attachmentData = await this._fetchEntity("/SupplierAttachments", [
                new Filter("RfqNumber", FilterOperator.EQ, rfqNum),
                new Filter("Bidder", FilterOperator.EQ, bidder),
                new Filter("ACCOUNT_GROUP", FilterOperator.EQ, accountGroup)
            ]);
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

        /************************************
         * UI STATE MANAGEMENT
         ************************************/
        _updateUIState: function (sStatus) {
            const oUIState = this.getView().getModel("uiState").getData();
            const oWorkHeaderData = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0") || {};

            console.log("Updating UI State:", {
                RFQStatus: sStatus,
                ResponseStatus: oWorkHeaderData.ResponseStatus || "Not loaded",
                AttachmentStatus: oWorkHeaderData.AttachmentStatus || "Not loaded",
                CurrentUIState: oUIState
            });

            // Reset UI state
            this._resetUIState(oUIState);

            // Handle DRAFT status
            if (sStatus === this.STATUS.DRAFT) {
                oUIState.sections.eventOverview.visible = true;
                oUIState.sections.eventOverview.enabled = true;

                oUIState.sections.preRequisite.visible = true;
                oUIState.sections.preRequisite.enabled = oWorkHeaderData.ResponseStatus !== "Completed" && oWorkHeaderData.AttachmentStatus !== "Completed";

                oUIState.sections.createQuotation.visible = true;
                oUIState.sections.createQuotation.enabled = oWorkHeaderData.ResponseStatus === "Completed" && oWorkHeaderData.AttachmentStatus === "Completed" && oUIState.submission.state !== this.SUBMISSION_STATES.PREVIEW;

                oUIState.buttons.reviseQuotation.visible = true;
                oUIState.buttons.reviseQuotation.enabled = true;
                oUIState.buttons.revisePreRequisite.visible = true;
                oUIState.buttons.revisePreRequisite.enabled = true;

                oUIState.buttons.addCharge.visible = false;
                oUIState.buttons.addCharge.enabled = false;
                oUIState.buttons.deleteCharge.visible = false;
                oUIState.buttons.deleteCharge.enabled = false;

                if (oUIState.submission.state === this.SUBMISSION_STATES.EDITING) {
                    oUIState.buttons.submit.visible = true;
                    oUIState.buttons.submit.enabled = true;
                    oUIState.buttons.draft.visible = true;
                    oUIState.buttons.draft.enabled = true;
                }

                if (oUIState.submission.state === this.SUBMISSION_STATES.SUBMITTING) {
                    oUIState.sections.preview.visible = true;
                }
            }

            console.log("Final UI State:", oUIState);
            this.getView().getModel("uiState").setData(oUIState);
            this.getView().getModel("uiState").refresh(true);
            this.getView().rerender();
        },

        _resetUIState: function (oUIState) {
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

        /************************************
         * VALIDATION
         ************************************/
        _isDeadlinePassed: function () {
            // return false;
            const oWorkHeaderData = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");
            return oWorkHeaderData?.Deadline_dt && new Date() > new Date(oWorkHeaderData.Deadline_dt);
        },

        _validateFile: function (oFile) {
            if (!oFile) {
                this._showError("No file selected");
                return false;
            }
            const maxSize = this.MAX_FILE_SIZE_MB * 1024 * 1024;
            if (oFile.size > maxSize) {
                this._showError(`File size exceeds ${this.MAX_FILE_SIZE_MB} MB limit`);
                return false;
            }
            return true;
        },

        _validatePreRequisites: function (aQuestions, aAttachments) {
            const errors = [];

            if (!aQuestions.length && !aAttachments.length) {
                errors.push("No pre-requisite questions or attachments defined by admin");
            } else {
                if (!aQuestions.length) errors.push("No pre-requisite questions defined by admin");
                if (!aAttachments.length) errors.push("No pre-requisite attachments defined by admin");
            }

            const aInvalidQuestions = aQuestions.filter(q => !q.RESPONSE);
            if (aInvalidQuestions.length) {
                errors.push("Please answer all questions");
            }

            const aInvalidAttachments = aAttachments.filter(a =>
                (!a.IS_PRESENT && !a.RESPONSE_REASON_FOR_ABSENCE) ||
                !a.RESPONSE_DESCRIPTION ||
                (a.IS_PRESENT && (!a.RESPONSE_FILE_NAME || !a.RESPONSE_FILE_URL || !a.RESPONSE_DESCRIPTION))
            );

            if (aInvalidAttachments.length) {
                const nothingProvided = aInvalidAttachments
                    .filter(a => !a.IS_PRESENT && !a.RESPONSE_REASON_FOR_ABSENCE && !a.RESPONSE_DESCRIPTION)
                    .map(a => a.DESCRIPTION);
                if (nothingProvided.length) {
                    errors.push(`No file, reason, or description provided for: ${nothingProvided.join(", ")}`);
                }

                const missingFileOrReason = aInvalidAttachments
                    .filter(a => !a.IS_PRESENT && !a.RESPONSE_REASON_FOR_ABSENCE)
                    .map(a => a.DESCRIPTION);
                if (missingFileOrReason.length) {
                    errors.push(`Please provide a file or reason for: ${missingFileOrReason.join(", ")}`);
                }

                const missingDescription = aInvalidAttachments
                    .filter(a => !a.RESPONSE_DESCRIPTION)
                    .map(a => a.DESCRIPTION);
                if (missingDescription.length) {
                    errors.push(`Description is missing for: ${missingDescription.join(", ")}`);
                }

                const missingFileFields = aInvalidAttachments
                    .filter(a => a.IS_PRESENT && (!a.RESPONSE_FILE_NAME || !a.RESPONSE_FILE_URL))
                    .map(a => `Missing required fields for ${a.DESCRIPTION}: ${[!a.RESPONSE_FILE_NAME ? "File Name" : "", !a.RESPONSE_FILE_URL ? "File URL" : ""].filter(Boolean).join(", ")}`);
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

        _validateExcelFormat: function (oFile) {
            if (!oFile) return false;
            const sFileType = oFile.type;
            const aValidTypes = [
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel"
            ];
            return aValidTypes.includes(sFileType);
        },

        /************************************
         * USER ACTIONS
         ************************************/
        handleLinkPress: function () {
            this._navigateToList();
        },

        onSubmitRFQ: function () {
            const oUIState = this.getView().getModel("uiState").getData();

            let questionResponses = this.getView().getModel("oQuestionsModel").getProperty("/questions") || [];
            let uploadedAttachments = this.getView().getModel("oAttachmentsModel").getProperty("/attachments") || [];

            if (!this._validatePreRequisites(questionResponses, uploadedAttachments)) return;

            if (!this._validateQuotation()) return;

            this._showConfirm("Are you sure you want to submit the RFQ?", {
                title: "Confirm RFQ Submission",
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                onConfirm: (sAction) => {
                    if (sAction === MessageBox.Action.YES) {
                        this._setSubmissionState(this.SUBMISSION_STATES.SUBMITTING, true);
                        this._updateUIState(this.STATUS.DRAFT);

                        oUIState.buttons.finalSubmit.visible = true;
                        oUIState.buttons.finalSubmit.enabled = true;

                        this.getView().getModel("uiState").setData(oUIState);
                        this.getView().getModel("uiState").refresh(true);
                    }
                },
                onCancel: () => console.log("Cancelled")
            });
        },

        onFinalSubmit: function () {
            let questionResponses = this.getView().getModel("oQuestionsModel").getProperty("/questions") || [];
            let uploadedAttachments = this.getView().getModel("oAttachmentsModel").getProperty("/attachments") || [];

            if (!this._validatePreRequisites(
                questionResponses,
                uploadedAttachments
            )) return;

            if (!this._validateQuotation()) return;

            this._setBusy(true);

            this._showConfirm("Are you sure you want to finalize the RFQ submission?", {
                title: "Confirm Final Submission",
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                onConfirm: async (sAction) => {
                    if (sAction === MessageBox.Action.YES) {
                        try {
                            let oPreReqRes = await this._savePreRequisites();
                            let oQuotRes = await this._saveQuotation();
                            // await this._updateRFQStatus("submit", this.STATUS.SUBMITTED);
                            // MessageToast.show("RFQ submitted successfully");
                            // this._navigateToList();
                            let that = this;
                            if (oPreReqRes && oQuotRes) {
                                this._showSuccess("RFQ submitted successfully", {
                                    title: "Success",
                                    actions: [MessageBox.Action.OK],
                                    onClose: function (sAction) {
                                        if (sAction === MessageBox.Action.OK) {
                                            that._navigateToList();
                                        }
                                    }
                                });
                            }
                        } catch (oError) {
                            this._showError(oError.message || "Failed to submit RFQ");
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

        onSaveDraft: function () {
            if (this._isDeadlinePassed()) {
                this._showError("Cannot submit after the deadline has passed");
                return false;
            }

            const oUIState = this.getView().getModel("uiState").getData();

            this._showConfirm("Are you sure you want to save the RFQ as a draft?", {
                title: "Confirm Save Draft",
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                onConfirm: async (sAction) => {
                    if (sAction === MessageBox.Action.YES) {
                        this._setSubmissionState(this.SUBMISSION_STATES.SUBMITTING, true);
                        this._updateUIState(this.STATUS.DRAFT);

                        oUIState.sections.createQuotation.visible = true;
                        oUIState.sections.createQuotation.enabled = false;

                        oUIState.buttons.finalDraft.visible = true;
                        oUIState.buttons.finalDraft.enabled = true;

                        this.getView().getModel("uiState").setData(oUIState);
                        this.getView().getModel("uiState").refresh(true);
                    }
                },
                onCancel: () => {
                    this._setBusy(false);
                }
            });
        },

        onFinalDraft: function () {
            if (this._isDeadlinePassed()) {
                this._showError("Cannot submit after the deadline has passed");
                return false;
            }

            this._showConfirm("Are you sure you want to finalize the draft?", {
                title: "Confirm Final Draft",
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                onConfirm: async (sAction) => {
                    if (sAction === MessageBox.Action.YES) {
                        try {
                            this._setBusy(true);
                            let oResponse = await this._updateDraft();
                            // this._updateUIState(this.CONFIG.STATUS.DRAFT);
                            // MessageToast.show("Draft finalized successfully.");
                            // this._navigateToList();
                            let that = this;
                            if (oResponse) {
                                this._showSuccess("Draft finalized successfully.", {
                                    title: "Success",
                                    actions: [MessageBox.Action.OK],
                                    onClose: function (sAction) {
                                        if (sAction === MessageBox.Action.OK) {
                                            that._navigateToList();
                                        }
                                    }
                                });
                            }
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
                    this._showError(oError.message);
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

        // Event handler for answer selection
        onAnswerSelect: function (oEvent) {
            const oSource = oEvent.getSource();
            const bindingContext = oSource.getBindingContext("oQuestionsModel");

            let selectedValue = "";

            if (oSource.isA("sap.m.RadioButtonGroup")) {
                const selectedIndex = oEvent.getParameter("selectedIndex");
                selectedValue = selectedIndex === 0 ? "Yes" : "No";
            } else if (oSource.isA("sap.m.Select")) {
                selectedValue = oEvent.getParameter("selectedItem").getKey();
            }

            // Update the response in model
            bindingContext.getModel().setProperty(bindingContext.getPath() + "/RESPONSE", selectedValue);
        },

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
                    return;
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
            const headers = ["Item No", "Material No - Description", "UOM", "Plant", "Required Quantity", "Net Price - INR", "Total Price"];
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
                if (isNaN(netPrice) || netPrice < 0) invalidRows.push(`Row ${index + 1}: Invalid Net Price`);
                if (isNaN(quantity) || quantity < 0) invalidRows.push(`Row ${index + 1}: Invalid Quantity`);
                else validRows.push({ itemNumber: row[0], netPrice: row[5], quantity: row[4] });
            });
            return { isValid: !invalidRows.length, invalidRows, validRows };
        },

        _updateWorkItems: function (validRows) {
            const oWorkItemsModel = this.getView().getModel("oWorkItemsModel");
            const aItems = oWorkItemsModel.getProperty("/results");
            validRows.forEach(row => {
                const oItem = aItems.find(item => item.ItemNumber === row.itemNumber);
                if (oItem) {
                    oItem.Netpr = row.netPrice;
                    oItem.Netwr = row.netPrice * row.quantity;
                }
            });
            oWorkItemsModel.setProperty("/results", aItems);
        },

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
            this._oAddChargeDialog.close();
        },

        onCancelCharge: function () {
            this._resetChargeInputs();
            this._oAddChargeDialog.close();
        },

        onDeleteCharges: function () {
            const oTable = this.getView().byId("draftchargesTable");
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

        onUploadChange: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext("oAttachmentsModel");
            const oAttachment = oContext.getObject();
            const oFile = oEvent.getParameter("files")?.[0];

            if (!this._validateFile(oFile)) return;

            const reader = new FileReader();
            reader.onload = () => {
                oAttachment.RESPONSE_FILE_NAME = oFile.name;
                oAttachment.RESPONSE_FILE_URL = reader.result.split(",")[1];
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
                const mimeType = this._getMimeType(sFileName?.split(".").pop()?.toLowerCase() || "");
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

                        const oFileUploader = oEvent.getSource().getParent().getParent().getItems()[1].getItems()[1];
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
            debugger;
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

        // Event handlers for buttons
        onRevisePreRequisite: function () {
            const oUIState = this.getView().getModel("uiState").getData();

            this._setSubmissionState(this.SUBMISSION_STATES.EDITING, false);

            // Show Final Submit and Final Draft buttons
            this._updateUIState(this.STATUS.DRAFT, true);

            oUIState.sections.preRequisite.visible = true;
            oUIState.sections.preRequisite.enabled = true;
            oUIState.sections.createQuotation.visible = true;
            oUIState.sections.createQuotation.enabled = false;

            this.getView().getModel("uiState").setData(oUIState);
            this.getView().getModel("uiState").refresh(true);
        },

        onReviseQuotation: function () {
            const oUIState = this.getView().getModel("uiState").getData();

            this._setSubmissionState(this.SUBMISSION_STATES.EDITING, false);

            // Show Final Submit and Final Draft buttons
            this._updateUIState(this.STATUS.DRAFT, true);

            oUIState.buttons.addCharge.visible = true;
            oUIState.buttons.addCharge.enabled = true;
            oUIState.buttons.deleteCharge.visible = true;
            oUIState.buttons.deleteCharge.enabled = true;

            this.getView().getModel("uiState").setData(oUIState);
            this.getView().getModel("uiState").refresh(true);
        },


        /************************************
         * DATA OPERATIONS
         ************************************/
        _savePreRequisites: function () {
            const { RfqNumber, Bidder, VendorAccgrp } = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");
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

        _saveQuotation: function () {
            const { RfqNumber, Bidder } = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");
            const aItems = this.getView().getModel("oWorkItemsModel").getProperty("/results");
            const oWorkHeader = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");

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
                Additional_Charges: oWorkHeader.Additional_Charges || [],
                Additional_Attachments: oWorkHeader.Additional_Attachments || []
            };

            console.log("Saving Quotation with payload:", oPayload);
            return this._createEntity("/EditRFQ", oPayload);
        },

        _updateDraft: async function () {
            const aWorkItems = this.getView().getModel("oWorkItemsModel").getProperty("/results");
            const oWorkHeaderData = this.getView().getModel("oWorkHeaderModel").getProperty("/results/0");

            const oDraftData = {
                RfqNumber: oWorkHeaderData.RfqNumber,
                Bidder: oWorkHeaderData.Bidder,
                Status: "Draft",
                items: aWorkItems.map(oItem => ({
                    RfqNumber: oWorkHeaderData.RfqNumber,
                    ItemNumber: oItem.ItemNumber,
                    Bidder: oWorkHeaderData.Bidder,
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

            // const sEntityPath = this.getView().getModel().createKey("/ZC_AISP_RFQ_DRAFT", {
            //     RfqNumber: oWorkHeaderData.RfqNumber,
            //     Bidder: oWorkHeaderData.Bidder
            // });

            // await this._updateEntity("/ZC_AISP_RFQ_DRAFT", oDraftData);

            // Create the proper entity path with keys
            const sEntityPath = `/ZC_AISP_RFQ_DRAFT(RfqNumber='${oWorkHeaderData.RfqNumber}',Bidder='${oWorkHeaderData.Bidder}')`;

            try {
                // Call your update method with the properly formatted path
                return this._updateEntity(sEntityPath, oDraftData);
                // MessageToast.show("Draft updated successfully");
            } catch (error) {
                MessageBox.error("Failed to update draft: " + error.message);
            }

            // await this._updateEntity(sEntityPath, oDraftData);
        },

        /************************************
        * HANDLERS
        ************************************/

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

        _fetchEntity: function (sPath, aFilters) {
            return new Promise((resolve, reject) => {
                this.getView().getModel().read(sPath, {
                    filters: aFilters,
                    success: oData => resolve(oData.results),
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

        _updateEntity: function (sPath, oPayload) {
            const oModel = this.getView().getModel();
            return new Promise((resolve, reject) => {
                oModel.update(sPath, oPayload, {
                    method: "PUT",          // Force PUT instead of MERGE
                    merge: false,           // Disable merge behavior
                    success: (oData) => {
                        oModel.refresh(sPath); // Refresh only the updated entity
                        resolve(oData);
                    },
                    error: (oError) => {
                        console.error("Update failed:", oError);
                        reject(oError);
                    }
                });
            });
        },

        /************************************
         * SUBMISSION STATE MANAGEMENT
         ************************************/
        _setSubmissionState: function (sState, bIsSubmitting = false) {
            const oUIState = this.getView().getModel("uiState").getData();
            oUIState.submission.state = sState;
            oUIState.submission.isSubmitting = bIsSubmitting;
            this.getView().getModel("uiState").setData(oUIState);
            this.getView().getModel("uiState").refresh(true);
            if (sState === this.SUBMISSION_STATES.PREVIEW) this._scrollToPreview();
        },

        _scrollToPreview: function () {
            const oPage = this.getView().byId("ObjectPageLayout");
            const oPreviewSection = this.getView().byId("previewSection");
            if (oPage && oPreviewSection) oPage.scrollToSection(oPreviewSection.getId());
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

        /************************************
         * FORMATTER FUNCTIONS
         ************************************/
        formatDateTime: function (datePart, timePart) {
            if (!datePart) return "";
            try {
                const dateObj = new Date(datePart);
                if (timePart && typeof timePart === "string" && timePart.includes(":")) {
                    const [hours, minutes] = timePart.split(":");
                    dateObj.setHours(parseInt(hours, 10));
                    dateObj.setMinutes(parseInt(minutes, 10));
                }
                const day = String(dateObj.getDate()).padStart(2, "0");
                const month = String(dateObj.getMonth() + 1).padStart(2, "0");
                const year = dateObj.getFullYear();
                let hours = dateObj.getHours();
                const minutes = String(dateObj.getMinutes()).padStart(2, "0");
                const ampm = hours >= 12 ? "PM" : "AM";
                hours = hours % 12 || 12;
                return `${day}-${month}-${year} ${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
            } catch (e) {
                console.error("Date formatting error:", e);
                return datePart || "";
            }
        },

        formatDate: function (sDate) {
            if (!sDate) return "";
            return sap.ui.core.format.DateFormat.getDateInstance({ pattern: "dd-MM-yyyy" }).format(new Date(sDate));
        },

        formatStatusState: function (sStatus) {
            const mStatusStates = {
                [this.STATUS.DRAFT]: "Indication16",
                [this.STATUS.SUBMITTED]: "Indication14"
            };
            return mStatusStates[sStatus] || "None";
        },

        /************************************
         * UTILITY METHODS
         ************************************/
        _setBusy: function (bBusy) {
            this.getView().setBusy(bBusy);
        },

        _showConfirm: function (sMessage, oOptions = {}) {
            MessageBox.confirm(sMessage, {
                title: oOptions.title || "Confirm",
                actions: oOptions.actions || [MessageBox.Action.YES, MessageBox.Action.NO],
                onClose: function (sAction) {
                    if (sAction === (oOptions.actions?.[0] || MessageBox.Action.YES)) {
                        oOptions.onConfirm?.(sAction);
                    } else {
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
                oUIState.submission.state = this.CONFIG.SUBMISSION_STATES.PREVIEW;
                oUIState.submission.isSubmitting = false;
                oUIStateModel.setData(oUIState);
                oUIStateModel.refresh(true);
            }
        }
    });
});