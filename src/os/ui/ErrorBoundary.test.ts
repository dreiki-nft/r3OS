import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorBoundary, errorDetails } from './ErrorBoundary'

describe('ErrorBoundary', () => {
  it('derives an isolated error state and renders the illegal-operation box', () => {
    const error = new Error('boom')
    error.stack = ['Error: boom', 'at one', 'at two', 'at three', 'at four', 'at five', 'at six'].join('\n')

    const crashed = new ErrorBoundary({ children: 'broken', onClose: () => {} })
    crashed.state = ErrorBoundary.getDerivedStateFromError(error)
    const crashedHtml = renderToStaticMarkup(crashed.render() as ReactElement)

    const sibling = new ErrorBoundary({ children: createElement('span', null, 'still running') })
    const siblingHtml = renderToStaticMarkup(sibling.render() as ReactElement)

    expect(crashedHtml).toContain('This program has performed an illegal operation')
    expect(crashedHtml).toContain('boom')
    expect(siblingHtml).toContain('still running')
  })

  it('shows only the first five stack lines after the error message', () => {
    const error = new Error('bad paint')
    error.stack = ['Error: bad paint', 'at 1', 'at 2', 'at 3', 'at 4', 'at 5', 'at 6'].join('\n')

    expect(errorDetails(error)).toBe('bad paint\nat 1\nat 2\nat 3\nat 4\nat 5')
  })
})
