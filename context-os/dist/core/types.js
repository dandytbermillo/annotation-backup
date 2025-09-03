"use strict";
/**
 * Core type definitions for Context-OS
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Agent = exports.Severity = exports.Status = void 0;
var Status;
(function (Status) {
    Status["PLANNED"] = "PLANNED";
    Status["IN_PROGRESS"] = "IN_PROGRESS";
    Status["TESTING"] = "TESTING";
    Status["COMPLETE"] = "COMPLETE";
    Status["BLOCKED"] = "BLOCKED";
    Status["ROLLBACK"] = "ROLLBACK";
})(Status || (exports.Status = Status = {}));
var Severity;
(function (Severity) {
    Severity["CRITICAL"] = "critical";
    Severity["HIGH"] = "high";
    Severity["MEDIUM"] = "medium";
    Severity["LOW"] = "low";
})(Severity || (exports.Severity = Severity = {}));
class Agent {
    context;
    constructor(context) {
        this.context = context;
    }
}
exports.Agent = Agent;
//# sourceMappingURL=types.js.map