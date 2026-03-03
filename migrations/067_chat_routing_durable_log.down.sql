-- Migration: Remove chat_routing_durable_log table
-- Reverses 067_chat_routing_durable_log.up.sql

DROP TABLE IF EXISTS chat_routing_durable_log CASCADE;
