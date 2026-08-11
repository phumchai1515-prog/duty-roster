/**
 * supabase.js — สร้าง client ตัวเดียวใช้ร่วมทุกหน้า
 * ถ้ายังไม่ได้ตั้งค่า env.js จะโยน ConfigError ให้หน้าเรียกจัดการเอง
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client = null;

export function getClient() {
  if (!isConfigured()) {
    throw new ConfigError('ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล — กรุณาแก้ไฟล์ assets/js/env.js');
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'duty-roster-auth',
      },
    });
  }
  return client;
}

/**
 * แปลง error จาก Supabase เป็นข้อความภาษาไทยที่ผู้ใช้เข้าใจได้
 * รายละเอียดดิบยังเก็บไว้ใน console สำหรับผู้ดูแลระบบ
 */
export function humanError(error, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง') {
  if (!error) return fallback;
  console.error('[duty-roster]', error);

  const code = error.code ?? '';
  const message = String(error.message ?? '');

  if (code === '23505' || message.includes('duplicate key')) {
    return 'เวรวันนี้ถูกจองไปแล้ว กรุณารีเฟรชหน้าจอแล้วเลือกวันอื่น';
  }
  if (code === '42501' || message.includes('row-level security')) {
    return 'คุณไม่มีสิทธิ์ทำรายการนี้';
  }
  if (message.includes('Invalid login credentials')) {
    return 'รหัส PIN ไม่ถูกต้อง กรุณาลองใหม่';
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต';
  }
  if (message.includes('Email logins are disabled')) {
    return 'ระบบยังไม่เปิดใช้การเข้าสู่ระบบ กรุณาแจ้งผู้ดูแลระบบ';
  }
  return message || fallback;
}
