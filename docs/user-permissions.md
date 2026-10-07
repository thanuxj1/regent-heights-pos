# Giving staff access

Set on **User Management → Edit user → Permissions**. Only an Administrator can
change permissions; it cannot be handed on to anyone else.

## Two kinds of switch

**Default permissions** — what the person's role already includes (a cashier's
till, cash drawer, front desk…). Switch one off to restrict that one account
without touching anyone else in the same role. A cashier whose till is switched
off sees a notice on the till saying so.

**Additional permissions** — extra back-office access, for **Cashier accounts
only**. A waiter or kitchen account that needs back-office pages is made a
Cashier first. (Their screens have no way to reach those pages, and the pages
need cashier-level data to work.)

| Permission | Opens | Lets them |
|---|---|---|
| Reports & Accounting | Reports, Accounting | read every report, record expenses |
| Supplier Management | Suppliers, Supplier Ledger | add, change and pay suppliers |
| Purchase Orders | Suppliers, Supplier Ledger, **Add Inventory Item** | record what was bought (adding a new supplier on the way), receive it |
| Product & Menu Management | Menu / Products (incl. add, edit, product page), Categories | change the menu, prices, stock counts |
| Raw Materials & Stock | Inventory | add ingredients, count and adjust stock |
| Hotel & Room Management | Room Types, Meal Plans, Hotel Profile (stay policy) | change room types, rates, meal plans, check-in/out times |
| Waste Tracking | Waste Tracking | record waste |
| Cash Drawer Administration | Hotel Profile (drawer PIN) | see drawer history, set the drawer PIN |
| Activity Log / Audit | Activity Log | read who did what |
| Branch Settings | Hotel Profile (property details) | change the details printed on bills |
| Delivery Management | Delivery COD | add delivery partners, record riders' cash |
| Commission Agents | Commission Agents | add agents, record commission |
| User Management *(sensitive)* | User Management (list, add, edit) | add and edit staff — never anyone who outranks them, never above their own rank, and never their permissions |

## How it behaves

- A change takes effect on the server at once, both ways. The person's menu
  updates when they next come back to the window (or within a minute).
- Changing someone's role clears their permissions; set them again for the new role.
- Each switch saves on its own; while one is saving the others wait, so two quick
  clicks can't undo each other.
- Every change is written to the Activity Log ("granted …", "revoked …").

Tested end to end in `Server/tests/t17-granted-access.mjs`.
