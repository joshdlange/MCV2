---
name: Messaging order and opening position
description: User's explicit inbox ordering and conversation scrolling requirements.
---

Sort conversations by the last RECEIVED message, with received conversations above sent-only conversations. Opening a conversation must show the bottom/latest exchange, like text messaging, on both mobile and desktop.

**Why:** The user repeated this requirement after outbound messages still displaced incoming conversations and opened threads did not reliably show the latest message.

**How to apply:** Sending must not change a conversation's received-message priority. Ensure the mobile scroll container has a bounded height and account for delayed images when positioning a newly opened conversation.
