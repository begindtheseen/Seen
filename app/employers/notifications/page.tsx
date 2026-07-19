```typescript
import Link from 'next/link';

export default function NotificationsPage() {
  return (
    <div>
      <h1>Notifications</h1>
      <ul>
        <li><Link href="/employers/notifications/1">New applicant applied to your job listing.</Link></li>
        <li><Link href="/employers/notifications/2">Your job listing is expiring soon.</Link></li>
      </ul>
    </div>
  );
}
```
