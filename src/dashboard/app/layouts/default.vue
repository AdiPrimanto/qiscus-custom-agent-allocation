<template>
  <div class="h-screen overflow-auto bg-white">
    <header class="border-b border-gray-200 bg-white">
      <div class="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
        <div class="flex items-center gap-2 font-bold text-gray-900">
          <span class="h-5 w-5 rounded-full bg-primary-500" />
          CAA Dashboard
        </div>
        <nav class="flex gap-1">
          <NuxtLink
            to="/"
            class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            active-class="!bg-primary-50 !text-primary-700"
          >
            Overview
          </NuxtLink>
          <NuxtLink
            to="/agents"
            class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            active-class="!bg-primary-50 !text-primary-700"
          >
            Agents
          </NuxtLink>
          <NuxtLink
            to="/assignments"
            class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            active-class="!bg-primary-50 !text-primary-700"
          >
            Assignments
          </NuxtLink>
        </nav>
      </div>
    </header>
    <main class="mx-auto max-w-5xl px-6 py-8">
      <slot />
    </main>
  </div>
</template>
