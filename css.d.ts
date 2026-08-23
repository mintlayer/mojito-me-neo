// TS 6 rejects side-effect imports without declarations; the .css import is
// handled by the metro/nativewind pipeline, not the type system.
declare module '*.css' {}
