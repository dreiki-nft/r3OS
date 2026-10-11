/**
 * Page translators (Chrome's built-in Translate, language and AI-assistant extensions) swap the text React
 * rendered for their own <font> elements. When React later removes or reorders that text it finds the node
 * gone and throws "Failed to execute 'removeChild' on 'Node'", which took a whole window down ("This program
 * has performed an illegal operation"). A node that is no longer where React left it is already out of the
 * way, so skipping the call is safe: the window keeps working, and the translator's text may simply lag.
 * The standard workaround from the React issue tracker (facebook/react#11538).
 */
type NodeLike = { parentNode: unknown }
type MutableProto = {
  removeChild: (this: unknown, child: NodeLike) => unknown
  insertBefore: (this: unknown, node: NodeLike, reference: NodeLike | null) => unknown
}

export function guardNodeMutations(proto: MutableProto) {
  const removeChild = proto.removeChild
  proto.removeChild = function (child) {
    if (child.parentNode !== this) return child
    return removeChild.call(this, child)
  }
  const insertBefore = proto.insertBefore
  proto.insertBefore = function (node, reference) {
    if (reference && reference.parentNode !== this) return node
    return insertBefore.call(this, node, reference)
  }
}

export function installDomGuard() {
  if (typeof Node === 'function' && Node.prototype)
    guardNodeMutations(Node.prototype as unknown as MutableProto)
}
