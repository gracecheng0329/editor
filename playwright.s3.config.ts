import { defineConfig } from '@playwright/test'
import s2Config from './playwright.s2.config'

export default defineConfig({ ...s2Config, testDir: './tests/s3' })
