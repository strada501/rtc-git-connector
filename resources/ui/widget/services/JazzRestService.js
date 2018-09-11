define([
    "dojo/_base/declare",
    "dojo/_base/array",
    "dojo/json",
    "dojo/request/xhr",
    "dojo/Deferred",
    "../components/NewWorkItemList/NewWorkItemList"
], function (declare, array, json, xhr, Deferred, NewWorkItemList) {
    var _instance = null;
    var JazzRestService = declare(null, {
        commitLinkEncoder: null,
        ajaxContextRoot: null,
        allRegisteredGitRepositoriesUrl: null,
        currentUserUrl: null,
        personalTokenServiceUrl: null,
        gitCommitServiceUrl: null,
        richHoverServiceUrl: null,
        gitCommitLinkTypeId: "com.ibm.team.git.workitem.linktype.gitCommit",
        relatedArtifactLinkTypeId: "com.ibm.team.workitem.linktype.relatedartifact",
        issueLinkTypeId: "org.jazzcommunity.git.link.git_issue",
        requestLinkTypeId: "org.jazzcommunity.git.link.git_mergerequest",

        constructor: function () {
            // Prevent errors in Internet Explorer (dojo parse error because undefined)
            if (typeof com_siemens_bt_jazz_rtcgitconnector_modules !== 'undefined') {
                this.commitLinkEncoder = new com_siemens_bt_jazz_rtcgitconnector_modules.encoder();
            }

            this.ajaxContextRoot = net.jazz.ajax._contextRoot;
            this.allRegisteredGitRepositoriesUrl =
                    this.ajaxContextRoot +
                    "/service/com.ibm.team.git.common.internal.IGitRepositoryRegistrationRestService/allRegisteredGitRepositories";
            this.currentUserUrl = this.ajaxContextRoot + "/authenticated/identity";
            this.personalTokenServiceUrl =
                this.ajaxContextRoot +
                "/service/com.siemens.bt.jazz.services.PersonalTokenService.IPersonalTokenService/tokenStore";
            this.gitCommitServiceUrl =
                this.ajaxContextRoot +
                "/com.ibm.team.git.internal.resources.IGitResourceRestService/commit";
            this.richHoverServiceUrl =
                this.ajaxContextRoot +
                "/service/org.jazzcommunity.GitConnectorService.IGitConnectorService";

            this._createLinkTypeContainerGetters();
        },

        // Create and fill work items from the git issues.
        createNewWorkItems: function (currentWorkItem, gitIssues, addBackLinksFunction, failureCallbackFunction) {
            var self = this;

            if (gitIssues && gitIssues.length) {
                // Set the first issue in the current work item
                this.setWorkItemValuesFromGitIssue(currentWorkItem, gitIssues[0]);

                // Update the new work item list
                NewWorkItemList.UpdateNewWorkItemList();
            }

            if (gitIssues && gitIssues.length > 1) {
                // A function for creating a work item and setting the values when it's ready
                var createWorkItemAndSetValue = function (currentGitIssue) {
                    var newWorkItem = self.createNewEmptyWorkItem(currentWorkItem);

                    (function (newWorkItem, currentGitIssue) {
                        // Only set the values after the work item has been initialized
                        var interval = setInterval(function () {
                            if (newWorkItem.isInitialized) {
                                clearInterval(interval);

                                // Wait a bit more because it's still not ready for some reason...
                                setTimeout(function () {
                                    self.setWorkItemValuesFromOriginalWorkItem(newWorkItem, currentWorkItem);
                                    self.setWorkItemValuesFromGitIssue(newWorkItem, currentGitIssue);

                                    // Update the new work item list
                                    NewWorkItemList.UpdateNewWorkItemList();
                                }, 100);
                            }
                        }, 100);
                    })(newWorkItem, currentGitIssue);
                };

                // Create work items and set values for any additional git issues
                for (var i = 1; i < gitIssues.length; i++) {
                    (function (currentGitIssue) {
                        createWorkItemAndSetValue(currentGitIssue);
                    })(gitIssues[i]);
                }
            }
        },

        // Create a new empty work item with the same type as the original work item
        createNewEmptyWorkItem: function (originalWorkItem) {
            var currentTimeStamp = new Date().getTime() + "0";
            var newWorkItemParams = {
                action: "com.ibm.team.workitem.newWorkItem",
                ts: currentTimeStamp,
                type: originalWorkItem.object.attributes.workItemType.id
            };
            jazz.app.currentApplication.workbench._pageWidgetCache["com.ibm.team.workitem"].controller.newWorkItem(newWorkItemParams);
            return com.ibm.team.workitem.web.cache.internal.Cache.getCache()["-" + currentTimeStamp];
        },

        // Copy a the values of a few attributes from the first work item
        // ["category", "owner", "target", "foundIn"]
        setWorkItemValuesFromOriginalWorkItem: function (newWorkItem, originalWorkItem) {
            // Set the category
            newWorkItem.setValue({
                path: ["attributes", "category"],
                attributeId: "category",
                value: originalWorkItem.object.attributes.category
            });

            // Set the owner
            newWorkItem.setValue({
                path: ["attributes", "owner"],
                attributeId: "owner",
                value: originalWorkItem.object.attributes.owner
            });

            // Set the planned for
            newWorkItem.setValue({
                path: ["attributes", "target"],
                attributeId: "target",
                value: originalWorkItem.object.attributes.target
            });

            // Set the found in
            newWorkItem.setValue({
                path: ["attributes", "foundIn"],
                attributeId: "foundIn",
                value: originalWorkItem.object.attributes.foundIn
            });
        },

        // Set values in the work item from the git issue. Also add a link to the git issue.
        setWorkItemValuesFromGitIssue: function (workItem, gitIssue) {
            if (gitIssue.title) {
                // Set the work item summary
                workItem.setValue({
                    path: ["attributes", "summary"],
                    attributeId: "summary",
                    value: gitIssue.title
                });
            }

            if (gitIssue.description) {
                // Set the work item description. Use <br /> instead of end line characters.
                workItem.setValue({
                    path: ["attributes", "description"],
                    attributeId: "description",
                    value: gitIssue.description.replace(/(\r\n|\n|\r)/gm, "<br />")
                });
            }

            if (gitIssue.labels) {
                // Set the git issue labels as tags
                workItem.setValue({
                    path: ["attributes", "internalTags"],
                    attributeId: "internalTags",
                    value: gitIssue.labels
                });
            }

            // Add the git issue as a link
            this.addIssueLinksToWorkItemObject(workItem, [gitIssue]);

            workItem.setValue({
                path: ["linkTypes"],
                value: workItem.object.linkTypes
            });
        },

        saveLinksInWorkItem: function (workItem, successCallbackFunction, failureCallbackFunction) {
            var onChangeFunc = {
                // Create a function to run after the linkType change
                changeFunc: function (event) {
                    // Remove the event listener so that this function is only called once
                    workItem.removeListener(listener);

                    // Save the changes
                    workItem.storeWorkItem({
                        operationMsg: 'Saving',
                        applyDelta: true,
                        onSuccess: function(params) {
                            console.log("Save Success");
                            successCallbackFunction();
                        },
                        onError: function(error) {
                            console.log("Save Error: ", error);
                            failureCallbackFunction(error);
                        }
                    });
                }
            };

            // Create a listener for changes to the linkTypes
            var listener = {
                path: ["linkTypes"],
                event: "onchange",
                listener: onChangeFunc,
                functionName: "changeFunc"
            };

            // Add the listener to the work item
            workItem.addListener(listener);

            // Set the linkTypes value on the work item.
            // This will also trigger the save
            workItem.setValue({
                path: ["linkTypes"],
                value: workItem.object.linkTypes
            });

            // Remove the listener again just incase it wasn't removed before (the event wasn't fired?)
            workItem.removeListener(listener);
        },

        // Adds links to the workItem object and saves them
        // The addBackLinksFunction is run on success without any parameters
        addLinksToWorkItem: function (workItem, registeredGitRepository, commitsToLink, issuesToLink, requestsToLink, addBackLinksFunction, failureCallbackFunction) {
            this.addCommitLinksToWorkItemObject(workItem, commitsToLink, registeredGitRepository);
            this.addIssueLinksToWorkItemObject(workItem, issuesToLink);
            this.addRequestLinksToWorkItemObject(workItem, requestsToLink);

            this.saveLinksInWorkItem(workItem, addBackLinksFunction, failureCallbackFunction);
        },

        // Save the specified commits to link as links in the passed work item object
        addCommitLinksToWorkItemObject: function (workItem, commitsToLink, registeredGitRepository) {
            var self = this;

            // Add links to commits
            if (commitsToLink && commitsToLink.length > 0) {
                // Get the commit link type container
                var commitLinkTypeContainer = this._getCommitLinkTypeContainer(workItem);

                // Add all commits to link to the link type container
                array.forEach(commitsToLink, function (commit) {
                    commitLinkTypeContainer.linkDTOs.push({
                        _isNew: true,
                        comment: commit.message.split(/\r?\n/g)[0] + " [@" + commit.sha + "]",
                        url: self._createCommitLinkUrl(commit, registeredGitRepository)
                    });
                });
            }
        },

        // Save the specified issues to link as links in the passed work item object
        addIssueLinksToWorkItemObject: function (workItem, issuesToLink) {
            // Add links to issues
            if (issuesToLink && issuesToLink.length > 0) {
                // Get the issue link type container
                var issueLinkTypeContainer = this._getIssueLinkTypeContainer(workItem);

                // Add all issues to link to the link type container
                array.forEach(issuesToLink, function (issue) {
                    var url = new URL(issue.webUrl);
                    var linkUrl = issue.webUrl;
                    if (url.hostname.indexOf('github') === -1) {
                        // Only use the link to the service for GitLab
                        linkUrl = issue.linkUrl;
                    }
                    issueLinkTypeContainer.linkDTOs.push({
                        _isNew: true,
                        comment: issue.title,
                        url: linkUrl
                    });
                });
            }
        },

        // Save the specified requests to link as links in the passed work item object
        addRequestLinksToWorkItemObject: function (workItem, requestsToLink) {
            // Add links to requests
            if (requestsToLink && requestsToLink.length > 0) {
                // Get the request link type container
                var requestLinkTypeContainer = this._getRequestLinkTypeContainer(workItem);

                // Add all requests to link to the link type container
                array.forEach(requestsToLink, function (request) {
                    var url = new URL(request.webUrl);
                    var linkUrl = request.webUrl;
                    if (url.hostname.indexOf('github') === -1) {
                        // Only use the link to the service for GitLab
                        linkUrl = request.linkUrl;
                    }
                    requestLinkTypeContainer.linkDTOs.push({
                        _isNew: true,
                        comment: request.title,
                        url: linkUrl
                    });
                });
            }
        },

        // Move issue and request links that were created as related artifacts to their own custom link types
        // Returns true if any changes where made; otherwise false
        moveOldLinksToNewLinkTypes: function (workItem) {
            var issueLinksRegex = /\/org\.jazzcommunity\.gitconnectorservice\.igitconnectorservice\/gitlab\/[^\/]+\/project\/[^\/]+\/issue\/[^\/]+\/link/gmi;
            var requestLinksRegex = /\/org\.jazzcommunity\.gitconnectorservice\.igitconnectorservice\/gitlab\/[^\/]+\/project\/[^\/]+\/merge-request\/[^\/]+\/link/gmi;
            var artifactLinkTypeContainer = this._getRelatedArtifactLinkTypeContainer(workItem);

            if (artifactLinkTypeContainer.linkDTOs.length) {
                var issueLinkObjects = [];
                var requestLinkObjects = [];

                for (var i = artifactLinkTypeContainer.linkDTOs.length - 1; i >= 0; i--) {
                    issueLinksRegex.lastIndex = 0;
                    requestLinksRegex.lastIndex = 0;

                    if (issueLinksRegex.test(artifactLinkTypeContainer.linkDTOs[i].url)) {
                        issueLinkObjects.push({
                            _isNew: true,
                            comment: artifactLinkTypeContainer.linkDTOs[i].comment,
                            url: artifactLinkTypeContainer.linkDTOs[i].url
                        });
                        artifactLinkTypeContainer.linkDTOs.splice(i, 1);
                    } else if (requestLinksRegex.test(artifactLinkTypeContainer.linkDTOs[i].url)) {
                        requestLinkObjects.push({
                            _isNew: true,
                            comment: artifactLinkTypeContainer.linkDTOs[i].comment,
                            url: artifactLinkTypeContainer.linkDTOs[i].url
                        });
                        artifactLinkTypeContainer.linkDTOs.splice(i, 1);
                    }
                }

                if (issueLinkObjects.length) {
                    var issueLinkTypeContainer = this._getIssueLinkTypeContainer(workItem);

                    array.forEach(issueLinkObjects, function (issueLinkObject) {
                        issueLinkTypeContainer.linkDTOs.push(issueLinkObject);
                    });
                }

                if (requestLinkObjects.length) {
                    var requestLinkTypeContainer = this._getRequestLinkTypeContainer(workItem);

                    array.forEach(requestLinkObjects, function (requestLinkObject) {
                        requestLinkTypeContainer.linkDTOs.push(requestLinkObject);
                    });
                }

                if (issueLinkObjects.length || requestLinkObjects.length) {
                    return true;
                }
            }

            return false;
        },

        getGitCommitLinksFromWorkItem: function (workItem) {
            var self = this;
            var linkedCommitUrls = [];
            var commitLinkTypeContainer = this._getCommitLinkTypeContainer(workItem);

            array.forEach(commitLinkTypeContainer.linkDTOs, function (commitLink) {
                var searchTerm = "/commit?value=";
                var lastIndex = commitLink.url.lastIndexOf(searchTerm);

                if (lastIndex != -1) {
                    var encodedCommit = commitLink.url.slice(lastIndex + searchTerm.length);
                    var linkCommit = json.parse(self.commitLinkEncoder.decode(encodedCommit));
                    linkedCommitUrls.push(linkCommit.u.toLowerCase());
                }
            });

            return linkedCommitUrls;
        },

        getRelatedArtifactLinksFromWorkItem: function (workItem) {
            var linkedUrls = [];
            var artifactLinkTypeContainer = this._getRelatedArtifactLinkTypeContainer(workItem);

            array.forEach(artifactLinkTypeContainer.linkDTOs, function (artifactLink) {
                linkedUrls.push(artifactLink.url.toLowerCase());
            });

            return linkedUrls;
        },

        getIssueLinksFromWorkItem: function (workItem) {
            var linkedIssueUrls = [];
            var issueLinkTypeContainer = this._getIssueLinkTypeContainer(workItem);

            array.forEach(issueLinkTypeContainer.linkDTOs, function (issueLink) {
                linkedIssueUrls.push(issueLink.url.toLowerCase());
            });

            return linkedIssueUrls;
        },

        getRequestLinksFromWorkItem: function (workItem) {
            var linkedRequestUrls = [];
            var requestLinkTypeContainer = this._getRequestLinkTypeContainer(workItem);

            array.forEach(requestLinkTypeContainer.linkDTOs, function (requestLink) {
                linkedRequestUrls.push(requestLink.url.toLowerCase());
            });

            return linkedRequestUrls;
        },

        // Get the access token for the user and host
        getAccessTokenByHost: function (hostUrl) {
            var deferred = new Deferred();

            xhr.get(this.personalTokenServiceUrl, {
                query: {
                    key: hostUrl
                },
                handleAs: "json",
                headers: {
                    "Accept": "application/json"
                }
            }).then(function (response) {
                deferred.resolve(response.token ? response.token : null);
            }, function (error) {
                // return null if the service didn't find a token
                // change this when the service is fixed (it should only need to check for 404)
                if (error.response.status >= 400 && error.response.status < 500) {
                    deferred.resolve(null);
                }

                deferred.reject(error);
            });

            return deferred.promise;
        },

        // Saves the specified access token using the specified host
        saveAccessTokenByHost: function (hostUrl, accessToken) {
            return xhr.post(this.personalTokenServiceUrl, {
                data: json.stringify({
                    key: hostUrl,
                    token: accessToken
                }),
                headers: {
                    "Content-Type": "application/json"
                }
            });
        },

        // Gets the Jazz user id. This is usually the email address.
        // Returns null if not found or on error.
        getCurrentUserId: function () {
            return xhr.get(this.currentUserUrl, {
                handleAs: "json",
                headers: {
                    "Accept": "application/json"
                }
            }).then(function (response) {
                return response.userId ? response.userId : null;
            }, function (error) {
                return null;
            });
        },

        // Gets the registered git repositories from the service. Returns a promise
        // with the first parameter of the function passed to "then" being the list
        // of registered git repositories from the specified project area. The list
        // will be empty if there was an error.
        getAllRegisteredGitRepositoriesForProjectArea: function (projectAreaId) {
            var self = this;
            return xhr.get(this.allRegisteredGitRepositoriesUrl, {
                query: {
                    findRecursively: "true",
                    ownerItemIds: projectAreaId,
                    populateProcessOwner: "false"
                },
                handleAs: "json",
                headers: {
                    "Accept": "text/json"
                }
            }).then(function (response) {
                return self._parseGitRepositories(response);
            }, function (error) {
                console.log("getAllRegisteredGitRepositoriesForProjectArea error: ", error.message || error);
                // Consider changing this in the future so that the error can be properly handled.
                // Currently the caller cannot tell the difference when there was an error or when
                // there actually were no repositories found.
                return [];
            });
        },

        // Get an array of git repository objects from the document provided by the service
        _parseGitRepositories: function (responseDocument) {
            var gitRepositories = responseDocument["soapenv:Body"].response.returnValue.values;

            if (typeof gitRepositories === "undefined") {
                // Set to an empty array when there aren't any values
                gitRepositories = [];
            } else {
                // Parse the configurationData because it contains a stringified json object
                for (var i = 0; i < gitRepositories.length; i++) {
                    gitRepositories[i].configurationData = json.parse(gitRepositories[i].configurationData);
                }
            }

            return gitRepositories;
        },

        // Creates a function that gets the specified link type container from the work item
        // If the container doesn't already exist, it's created and added to the work item
        _makeLinkTypeContainerGetter: function (linkTypeId, displayName, endpointId) {
            var self = this;
            return function (workItem) {
                var linkTypeContainer = workItem.object.linkTypes.find(function (linkType) {
                    return linkType.id === linkTypeId;
                });

                if (!linkTypeContainer) {
                    linkTypeContainer = self._getEmptyLinkTypeContainer(displayName, endpointId, linkTypeId);
                    workItem.object.linkTypes.push(linkTypeContainer);
                }

                return linkTypeContainer;
            };
        },

        // Creates a link type container with the specified values
        _getEmptyLinkTypeContainer: function (displayName, endpointId, id) {
            return {
                displayName: displayName,
                endpointId: endpointId,
                id: id,
                isSource: false,
                linkDTOs: []
            };
        },

        _createLinkTypeContainerGetters: function () {
            this._getCommitLinkTypeContainer = this._makeLinkTypeContainerGetter(
                this.gitCommitLinkTypeId,
                "Git Commits",
                "gitcommit"
            );

            this._getRelatedArtifactLinkTypeContainer = this._makeLinkTypeContainerGetter(
                this.relatedArtifactLinkTypeId,
                "Related Artifacts",
                "relatedArtifact"
            );

            this._getIssueLinkTypeContainer = this._makeLinkTypeContainerGetter(
                this.issueLinkTypeId,
                "Git Issues",
                "issue_target"
            );

            this._getRequestLinkTypeContainer = this._makeLinkTypeContainerGetter(
                this.requestLinkTypeId,
                "Git Merge / Pull Requests",
                "request_target"
            );
        },

        // Creates the url to the internal git service including the commit as a encoded value.
        // This is needed for the rich hover to work
        _createCommitLinkUrl: function (commit, registeredGitRepository) {
            var jsonString = json.stringify({
                c: commit.message,
                d: commit.authoredDate,
                e: commit.authorEmail,
                k: registeredGitRepository.key,
                n: commit.authorName,
                s: commit.sha,
                u: commit.webUrl
            });
            return this.gitCommitServiceUrl + "?value=" + this.commitLinkEncoder.encode(jsonString);
        },

        // TODO: Keep this despite being unused. If we decide to use custom commit links
        // this will remain handy.
        _createGitLabCommitLinkUrl: function(commit) {
            return this.richHoverServiceUrl + "/" + commit.service +
                "/" + new URL(commit.webUrl).hostname +
                "/project/" + commit.projectId +
                "/" + commit.type + "/" + commit.sha + "/link";
        },

        // TODO: This needs some cleaning up...
        // Keeping this even though it's no longer used. Might still be useful in the future.
        _createRichHoverUrl: function(artifact) {
            return this.richHoverServiceUrl + "/" + artifact.service +
                "/" + new URL(artifact.webUrl).hostname +
                "/project/" + artifact.projectId +
                "/" + artifact.type + "/" + artifact.iid +
                "/link";
        }
    });

    // Returns an instance so that you don't need to instantiate this class.
    // It's functions can be called directly after importing. Example:
    //      JazzRestService.getInstance();
    //      JazzRestService.destroyInstance();
    //
    // This is basically a singleton that can be asked to use a new instance when needed
    return new function () {
        // Gets the existing instance or creates one if none exists (singleton)
        this.getInstance = function () {
            if (!_instance) {
                _instance = new JazzRestService();
            }

            return _instance;
        };

        // Destroys the existing instance. It doesn't matter if none exists.
        // This causes the next call to getInstance to create a new instance
        this.destroyInstance = function () {
            _instance = null;
        };
    };
});