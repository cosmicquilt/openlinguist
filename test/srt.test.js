import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSrt, formatSrt } from '../src/srt.js'

test('parses a sloppy file: BOM, CRLF, dot millis, missing index and blank lines, ASS tags', () => {
  const text =
    '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n{\\an8}Hello\r\nthere\r\n\r\n' +
    '00:00:03.2 --> 00:00:04.000\r\nNo index line\r\n' +
    '3\r\n00:00:05,000 --> 00:00:06,000\r\nMissing blank line above\r\n\r\n' +
    '4\r\n00:00:07,000 --> 00:00:07,000\r\nZero length, dropped\r\n'
  assert.deepEqual(parseSrt(text), [
    { start: 1000, end: 2500, text: 'Hello\nthere' },
    { start: 3200, end: 4000, text: 'No index line' },
    { start: 5000, end: 6000, text: 'Missing blank line above' },
  ])
})

test('formats and re-parses to the same cues', () => {
  const cues = [
    { start: 0, end: 1234, text: 'One' },
    { start: 3723004, end: 3725000, text: 'Two\n<i>Dos</i>' },
  ]
  const srt = formatSrt(cues)
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,234\nOne\n\n2\n01:02:03,004 --> 01:02:05,000\n/)
  assert.deepEqual(parseSrt(srt), cues)
})
