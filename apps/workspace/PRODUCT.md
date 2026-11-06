# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Office workers in international teams: marketing, finance, operations, HR and project
leads whose daily material is spreadsheets, documents and slides. English is the primary
working language; Chinese must read equally well. They use the Repository view for three
jobs in roughly equal measure: finding a file and continuing to edit it, reviewing and
merging changes a colleague or an AI agent proposed, and following Issues and to-dos.

## Product Purpose

Univer Workspace is a deployable Office workspace where people and AI agents create,
collaborate on and review Sheets, Docs, Slides, Bases and Boards in one shared runtime.
Agents and people propose changes in isolated Worktrees; a person reviews them as a Pull
request and decides what is merged into shared content. Success is a team that trusts
shared files because every change was seen before it landed.

## Positioning

Version control for office content: the review-before-merge discipline of software teams,
applied to spreadsheets, documents and slides, with AI agents as first-class contributors
whose work a human approves.

## Operating Context

- The product has two UI modes over the same data. Wiki mode is a file-tree workspace.
  Repository mode, the default, is modeled on GitHub: a Home dashboard, a repository
  directory, repository pages with Code / Issues / Pull requests / Pages / Settings tabs,
  Pull request review, Issues, Recent and Pages.
- Repository mode keeps GitHub's habits and flow on purpose; its visual language is open
  to replacement.
- Content lives in Spaces (Personal and Team). A Space holds a hierarchy of Nodes; a Node
  without content is a Group (shown as a folder); content kinds include Sheet, Doc, Slide,
  Base and Board.
- People also reach the same content through the Workspace Agent and the uvw CLI.

## Capabilities and Constraints

- Product words in Repository mode: repository (Space), Pull request, Issue, Pages,
  Settings, Star.
- A Space has a name, slug, description, visibility, owner, members and star count. It has
  no color, icon or cover field today.
- Browser stack is React 19 with the existing Workspace web app; light and dark appearance
  are both supported.

## Brand Commitments

- Keep the name OfficeLab. Its visual identity, including the mark, may be redesigned.
- The result must not read as an AI-generated template, a traditional OA system, or a
  playful consumer app.

## Evidence on Hand

- Screenshots of the current Repository mode: `/tmp/verify-uvw/20261106-112430/evidence/current/`.
- Product screenshot: `docs/images/univer-workspace-en.png` (repository root).
- No real customer names, testimonials or usage metrics are available; prototypes use
  labeled synthetic content.

## Product Principles

1. Every change is seen before it lands; review is a calm ritual, not a chore.
2. People and agents are both contributors, and the interface always shows who did what.
3. Keep familiar habits; earn trust through precision rather than novelty.
4. Office content is the hero; chrome stays out of its way.
