<script setup lang="ts">
defineProps<{ step: number; title: string }>()
</script>

<template>
  <div class="step-card">
    <div class="step-head">
      <span class="step-no">{{ step }}</span>
      <span class="step-title">{{ title }}</span>
      <slot name="head-extra" />
    </div>
    <div class="step-body">
      <slot />
    </div>
  </div>
</template>
