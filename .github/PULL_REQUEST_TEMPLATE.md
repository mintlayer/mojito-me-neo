<!--
Security fix? Do not open a public PR. Email security@mintlayer.org first.
-->

## What changed and why

<!-- The user-facing behaviour, then the reason. Link the issue: Closes #123 -->

## Screenshots

<!-- Required for any visual change. Before/after if you altered something existing. -->

| Before | After |
|---|---|
|  |  |

## Checklist

- [ ] `npm run check` passes (theme test + `tsc --noEmit` + `eslint .`)
- [ ] Verified on a simulator or device — required if this touches UI, navigation or gestures,
      since a green typecheck has missed real runtime breakage here before
- [ ] Reused existing primitives from `src/ui/index.tsx` rather than adding a near-duplicate
- [ ] No hardcoded colours or spacing: values come from `src/theme.ts` or Tailwind tokens
- [ ] New icon-only controls and inputs have `accessibilityLabel`
- [ ] Any deliberate shortcut is marked with a `ponytail:` comment naming its ceiling
- [ ] No control claims an action it doesn't perform

## Anything reviewers should know

<!-- Trade-offs, follow-ups, things you deliberately left out. -->
