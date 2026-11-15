<!--
Sync Impact Report
Version change: unversioned scaffold -> 1.0.0 (initial adoption)
Modified principles:
- Principle 1 name -> I. Library-First
- Principle 2 name -> II. Test-Driven Development
- Principle 3 name -> III. Functional Programming
- Principle 4 name -> IV. Contract and Integration Testing
- Principle 5 name -> V. Simplicity and Maintainability
Added sections: Engineering Constraints, Development Workflow
Removed sections: none
Follow-up TODO: Confirm the original ratification date.
-->

# Spec Final Assignment Constitution

## Core Principles

### I. Library-First
Every feature MUST first be implemented as a standalone library with a clear purpose,
self-contained behavior, and an independently testable public interface. Application-specific
integration MUST follow only after the library behavior is tested. This order makes functionality
reusable and keeps application wiring from obscuring core behavior.

### II. Test-Driven Development (NON-NEGOTIABLE)
For every behavior change, tests MUST be written before implementation. The tests MUST be run and
shown to fail for the intended reason before code is written. Implementation MUST then make the
tests pass, followed by refactoring with the tests remaining green. Bug fixes MUST begin with a
test that reproduces the reported behavior.

### III. Functional Programming
Code MUST prefer pure functions, immutable data, and explicit inputs and outputs. Side effects
MUST be isolated at clear boundaries. Mutable shared state MUST NOT be introduced when a pure
function or immutable value can express the behavior clearly; this keeps logic predictable and
straightforward to test.

### IV. Contract and Integration Testing
Each library MUST have tests for its behavior and public contract. Integration tests MUST cover
behavior that crosses library or application boundaries, including changed contracts and shared
schemas. These tests complement, and do not replace, the test-first unit tests required by
Principle II.

### V. Simplicity and Maintainability
Implementations MUST use the simplest design that fully meets the requirement. Public behavior
and contracts MUST be documented where callers need that information. Unnecessary abstractions,
dependencies, and unrelated changes MUST be excluded so that the code remains understandable and
maintainable.

## Engineering Constraints

- Libraries MUST be independently testable without requiring application startup.
- Public interfaces MUST make inputs, outputs, and errors explicit.
- Tests MUST verify observable behavior and MUST NOT depend on execution order or shared mutable
  state.
- New dependencies MUST be necessary to fulfill the requirement and compatible with the library's
  standalone use.

## Development Workflow

1. Define the library behavior and public contract before application integration.
2. Write focused tests first, run them to verify the expected failure, then implement and refactor.
3. Add integration tests whenever behavior crosses a library or application boundary.
4. Before proposing a change, run the relevant tests and checks and review the change for
   constitution compliance.

## Governance

This constitution governs project development practices. Amendments MUST include a rationale and
be reviewed by project maintainers before adoption. Each amendment MUST update the version and
amendment date.

Versioning follows semantic versioning: MAJOR for backward-incompatible changes to principles or
governance, MINOR for new principles or materially expanded requirements, and PATCH for
clarifications or non-semantic wording changes. Compliance MUST be reviewed for each change and
during code review; any necessary deviation MUST be explicit in the change rationale.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): original adoption date is unknown | **Last Amended**: 2026-11-15
