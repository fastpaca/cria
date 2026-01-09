# Contributing to Cria

Thank you for your interest in contributing to Cria! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to seb@fastpaca.com.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/cria.git
   cd cria
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Build the project:
   ```bash
   pnpm build
   ```

## Development Workflow

### Running Tests

```bash
pnpm test          # Run tests once
pnpm test:watch    # Run tests in watch mode
```

### Code Quality

This project uses [Ultracite](https://github.com/haydenbleasel/ultracite) (powered by Biome) for linting and formatting.

```bash
pnpm check         # Check for issues
pnpm fix           # Auto-fix issues
```

Please run `pnpm fix` before committing to ensure your code meets the project's standards.

### Building

```bash
pnpm build
```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-new-memory-adapter`
- `fix/token-counting-edge-case`
- `docs/improve-api-documentation`

### Commit Messages

Write clear, concise commit messages that explain the "why" behind changes:
- Use the present tense ("Add feature" not "Added feature")
- Keep the first line under 72 characters
- Reference issues when applicable

### Pull Requests

1. Create a new branch from `main`
2. Make your changes
3. Ensure tests pass (`pnpm test`)
4. Ensure code quality checks pass (`pnpm check`)
5. Push to your fork
6. Open a pull request against `main`

#### PR Description

Include:
- A clear description of what the PR does
- Any breaking changes
- Related issue numbers (e.g., "Fixes #123")

## What to Contribute

### Good First Issues

Look for issues labeled `good first issue` for beginner-friendly tasks.

### Feature Requests

Before implementing a new feature, please open an issue to discuss it first. This helps ensure alignment with the project's goals.

### Bug Reports

When reporting bugs, please include:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant code snippets or error messages

## Project Structure

```
cria/
├── src/              # Source code
├── dist/             # Built output (generated)
├── examples/         # Example implementations
└── tests/            # Test files
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Feel free to open an issue for any questions about contributing.
