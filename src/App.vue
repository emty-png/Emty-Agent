<script setup lang="ts">
import SideBar from './components/sidebar/Sidebar.vue'
import TitleBar from './components/titlebar/Titlebar.vue'
import ChatView from './views/Chatview.vue'
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100vh">
    <TitleBar title="Emty Agent" />
    <div style="display: flex; flex: 1; overflow: hidden">
      <SideBar />
      <ChatView style="flex: 1" />
    </div>
  </div>
</template>
