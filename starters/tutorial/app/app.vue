<template>
  <NuxtPage />
</template>

<style>
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}
main {
  max-width: 32rem;
  margin: 3rem auto;
  padding: 0 1rem;
}
form {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
form input {
  flex: 1;
}
input,
button {
  padding: 0.5rem 0.75rem;
  font: inherit;
}
ul {
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid #8884;
}
li span {
  flex: 1;
}
.done {
  text-decoration: line-through;
  opacity: 0.6;
}
.muted {
  opacity: 0.7;
}
.error {
  color: #d33;
}
</style>
