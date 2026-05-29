import type { AmbiguousTermRule } from "./types.js";

export const AMBIGUOUS_OR_BANNED_TERMS: AmbiguousTermRule[] = [
  {
    term: "job",
    status: "banned",
    why: "It can mean Shoot, Shift, Assignment, or external work and causes model drift.",
    useInstead: ["Shoot", "Shift", "Assignment"]
  },
  {
    term: "event",
    status: "banned",
    why: "It collides with schedule items, status events, and webhook events.",
    useInstead: ["Shoot", "Clock Event", "Lifecycle Transition", "Webhook Delivery"]
  },
  {
    term: "status",
    status: "discouraged",
    why: "Used alone, it hides subsystem ownership and collapses unrelated state models.",
    useInstead: ["Shoot Status", "Approval Status", "Assignment Status", "Attendance Status", "Readiness State"]
  },
  {
    term: "note",
    status: "discouraged",
    why: "Used alone, it hides whether the record is operational, pre-service, or post-shoot.",
    useInstead: ["Operational Note", "Pre-Service Note", "Post-Shoot Evaluation Comment"]
  },
  {
    term: "problem",
    status: "discouraged",
    why: "It does not distinguish between Issue, Alert, and Exception.",
    useInstead: ["Issue", "Alert", "Exception"]
  },
  {
    term: "client",
    status: "discouraged",
    why: "It is vague between Organization and Contact.",
    useInstead: ["Organization", "Contact", "School Contact"]
  },
  {
    term: "user",
    status: "discouraged",
    why: "It blurs Employee, Contact, and authorization actors.",
    useInstead: ["Employee", "Contact", "Authorization Actor"]
  },
  {
    term: "admin",
    status: "discouraged",
    why: "It blurs system Admin, school administrator contacts, and leadership operators.",
    useInstead: ["Admin", "School Contact", "Leadership", "Manager"]
  },
  {
    term: "punch",
    status: "discouraged",
    why: "It loses the distinction between Clock Event and Time Clock Entry.",
    useInstead: ["Clock Event", "Time Clock Entry"]
  },
  {
    term: "warning",
    status: "discouraged",
    why: "It can refer to an Alert, blocked action reason, or UI-only message.",
    useInstead: ["Alert", "Blocked Action Reason", "Readiness Blocker"]
  }
];
