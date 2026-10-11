import { describe, expect, it } from 'vitest'
import { guardNodeMutations } from './domGuard'

class FakeNode {
  parentNode: FakeNode | null = null
  children: FakeNode[] = []
  removeChild(child: FakeNode) {
    if (child.parentNode !== this) throw new Error("Failed to execute 'removeChild' on 'Node'")
    this.children = this.children.filter((c) => c !== child)
    child.parentNode = null
    return child
  }
  insertBefore(node: FakeNode, reference: FakeNode | null) {
    if (reference && reference.parentNode !== this)
      throw new Error("Failed to execute 'insertBefore' on 'Node'")
    node.parentNode = this
    const at = reference ? this.children.indexOf(reference) : this.children.length
    this.children.splice(at, 0, node)
    return node
  }
}
guardNodeMutations(FakeNode.prototype as never)

describe('DOM guard for page translators', () => {
  it('ignores removing a text node a translator already swapped out', () => {
    const parent = new FakeNode()
    const text = new FakeNode()
    parent.insertBefore(text, null)
    // the translator replaces React's text with its own <font>
    parent.children = []
    const font = new FakeNode()
    parent.insertBefore(font, null)
    text.parentNode = null
    expect(() => parent.removeChild(text)).not.toThrow()
    expect(parent.children).toEqual([font])
  })

  it('ignores inserting before a node that moved, and still works normally', () => {
    const parent = new FakeNode()
    const a = new FakeNode()
    parent.insertBefore(a, null)
    const stray = new FakeNode()
    expect(() => parent.insertBefore(new FakeNode(), stray)).not.toThrow()
    parent.removeChild(a)
    expect(parent.children).toEqual([])
  })
})
