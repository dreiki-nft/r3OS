import { Icon } from '../ui/Icon'
import type { IconName } from '../icons'
export function Placeholder({ icon, title }: { icon: IconName; title: string }) {
  return (
    <div className="placeholder-program">
      <Icon name={icon} size={72} />
      <h2>{title}</h2>
      <p>this program is still being installed.</p>
    </div>
  )
}
