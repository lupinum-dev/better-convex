<template>
  <NuxtPage />
</template>

<style>
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
  --line: color-mix(in srgb, currentColor 15%, transparent);
}
body {
  margin: 0;
}
main {
  max-width: 44rem;
  margin: 2rem auto;
  padding: 0 1rem;
  display: grid;
  gap: 1rem;
}
h1,
h2 {
  margin: 0;
}
h2 {
  font-size: 1rem;
}
.row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
header.row h1 {
  margin-right: auto;
}
.card {
  border: 1px solid var(--line);
  border-radius: 0.75rem;
  padding: 1rem;
  display: grid;
  gap: 0.75rem;
}
.attention {
  border-color: orange;
}
.problem {
  border-color: crimson;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}
li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
  padding: 0.4rem 0;
  border-top: 1px solid var(--line);
}
/* Names come from people and agents: a 100-character word must wrap, not widen the page. */
.text {
  min-width: 0;
  overflow-wrap: anywhere;
}
li > .row {
  flex-shrink: 0;
}
.small {
  font-size: 0.85rem;
}
label {
  display: grid;
  gap: 0.25rem;
}
input,
select,
button {
  font: inherit;
  padding: 0.45rem 0.7rem;
  border-radius: 0.5rem;
  border: 1px solid var(--line);
}
input {
  flex: 1;
  min-width: 0;
}
select {
  max-width: 100%;
}
button {
  background: CanvasText;
  color: Canvas;
  border: 0;
  cursor: pointer;
}
button.secondary {
  background: transparent;
  color: inherit;
  border: 1px solid var(--line);
}
.muted {
  opacity: 0.65;
}
</style>
