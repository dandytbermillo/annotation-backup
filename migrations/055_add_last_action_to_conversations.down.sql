-- Migration: Remove last_action column from chat_conversations
-- Reverts: 055_add_last_action_to_conversations.up.sql

ALTER TABLE chat_conversations DROP COLUMN IF EXISTS last_action;
