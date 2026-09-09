import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
const SuperAdminDashboard = lazy(() => import('./pages/super-admin/Dashboard'));
const SuperAdminHotelManagement = lazy(() => import('./pages/super-admin/HotelManagement'));
const SuperAdminUserManagement = lazy(() => import('./pages/super-admin/UserManagement'));
const SuperAdminUserDetails = lazy(() => import('./pages/super-admin/UserDetails'));
const SuperAdminAddUser = lazy(() => import('./pages/super-admin/AddUser'));
const SuperAdminBranchManagement = lazy(() => import('./pages/super-admin/BranchManagement'));
const BranchManagement = lazy(() => import('./pages/admin/BranchManagement'));
const AddUser = lazy(() => import('./pages/admin/AddUser'));
const EditUser = lazy(() => import('./pages/admin/EditUser'));
const BranchProfile = lazy(() => import('./pages/admin/branch_profile'));
const HotelProfile = lazy(() => import('./pages/branch-admin/HotelProfile'));
const MenuCategories = lazy(() => import('./pages/branch-admin/Categories'));
const BranchProfileEdit = lazy(() => import('./pages/admin/branchProfileEdit'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const AdminProductManagement = lazy(() => import('./pages/admin/ProductManagement'));
const AdminAddProduct = lazy(() => import('./pages/admin/AddProduct'));
const AdminProductDetails = lazy(() => import('./pages/admin/ProductDetails'));
const ProductManagement = lazy(() => import('./pages/branch-admin/ProductManagement'));
const AddProduct = lazy(() => import('./pages/branch-admin/AddProduct'));
const ProductDetails = lazy(() => import('./pages/branch-admin/ProductDetails'));
const BranchAdminUserManagement = lazy(() => import('./pages/branch-admin/UserManagement'));
const BranchAdminAddUser = lazy(() => import('./pages/branch-admin/AddUser'));
const BranchAdminEditUser = lazy(() => import('./pages/branch-admin/EditUser'));
const CashierPos = lazy(() => import('./pages/cashier/CashierPos'));
const InvoicePreview = lazy(() => import('./pages/cashier/InvoicePreview'));
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminStatistics = lazy(() => import('./pages/admin/AdminStatistics'));
const AdminTransactions = lazy(() => import('./pages/admin/Transactions'));
const BranchAdminTransactions = lazy(() => import('./pages/branch-admin/Transactions'));
const KitchenOrders = lazy(() => import('./pages/branch-admin/KitchenOrders'));
const Promotions = lazy(() => import('./pages/admin/Promotions'));

// Route wrapper: if logged-in user is a Branch Admin (role_id = 1),
// send them to Product Management instead of showing Branch Profile.
const BranchProfileRouter = () => {
  const { user } = useAuth();

  // The admin branch page manages branch admins, passwords and deletion — none
  // of which is the property owner's business. They get their own page instead.
  if (Number(user?.role_id) === 1) {
    return <Navigate to="/branch-admin/hotel-profile" replace />;
  }

  return <BranchProfile />;
};
const AddRawMaterials = lazy(() => import('./pages/branch-admin/AddRawMaterials'));
const InventoryDashboard = lazy(() => import('./pages/branch-admin/InventoryDashboard'));
const SupplierManagement = lazy(() => import('./pages/branch-admin/SupplierManagement'));
const BranchAdminDashboard = lazy(() => import('./pages/branch-admin/Dashboard'));
const SalesRevenue = lazy(() => import('./pages/branch-admin/SalesRevenue'));
const CashierPerformance = lazy(() => import('./pages/branch-admin/CashierPerformance'));
const KitchenManagement = lazy(() => import('./pages/kitchen/KitchenManagement'));
const RecipeMapper = lazy(() => import('./pages/branch-admin/RecipeMapper'));
const RecipeMapperDetail = lazy(() => import('./pages/branch-admin/RecipeMapperDetail'));
const WaiterPos = lazy(() => import('./pages/waiter/WaiterPos'));
const CommissionAgents = lazy(() => import('./pages/branch-admin/CommissionAgents'));
const Accounting = lazy(() => import('./pages/branch-admin/Accounting'));
const FrontDesk = lazy(() => import('./pages/hotel/FrontDesk'));
const HotelBookings = lazy(() => import('./pages/hotel/Bookings'));
const BookingDetail = lazy(() => import('./pages/hotel/BookingDetail'));
const RoomTypes = lazy(() => import('./pages/hotel/RoomTypes'));
const RoomsPage = lazy(() => import('./pages/hotel/RoomsPage'));
const RoomRack = lazy(() => import('./pages/hotel/RoomRack'));
const GuestProfile = lazy(() => import('./pages/hotel/GuestProfile'));
const Guests = lazy(() => import('./pages/hotel/Guests'));
const HotelCalendar = lazy(() => import('./pages/hotel/Calendar'));
const Reports = lazy(() => import('./pages/hotel/Reports'));
const ActivityLog = lazy(() => import('./pages/hotel/ActivityLog'));

/** Shown while a route's chunk downloads — a beat, not a spinner-and-splash. */
function RouteFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh',
                  color: '#94A3B8', fontSize: 14 }}>
      Loading…
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/login" element={<Login />} />
      {/* Self-service signup is deliberately not routed. Properties are created
          by the platform (Super Admin) and staff accounts by the property's own
          Administrator, so nobody registers themselves. The RegisterStep pages
          are still in pages/ if a real signup is ever wanted; as written they
          only navigate between steps and create nothing. Unknown paths fall
          through to the catch-all below and land on the login page. */}

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute allowedRoles={[6]}>
            <SuperAdminDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/super-admin/hotels"
        element={
          <ProtectedRoute allowedRoles={[6]}>
            <SuperAdminHotelManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/super-admin/users"
        element={
          <ProtectedRoute allowedRoles={[6]}>
            <SuperAdminUserManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/super-admin/users/add"
        element={
          <ProtectedRoute allowedRoles={[6]}>
            <SuperAdminAddUser />
          </ProtectedRoute>
        }
      />

      <Route
        path="/super-admin/users/:id/edit"
        element={
          <ProtectedRoute allowedRoles={[6]}>
            <SuperAdminUserDetails />
          </ProtectedRoute>
        }
      />

      <Route
        path="/super-admin/branches"
        element={
          <ProtectedRoute allowedRoles={[6]}>
            <SuperAdminBranchManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branches"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <BranchManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/users"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <UserManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/users"
        element={
          <ProtectedRoute allowedRoles={[1, 2]}>
            <BranchAdminUserManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/users/add"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <AddUser />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/users/add"
        element={
          <ProtectedRoute allowedRoles={[1, 2]}>
            <BranchAdminAddUser />
          </ProtectedRoute>
        }
      />

      <Route
        path="/users/:userId/edit"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <EditUser />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/users/:userId/edit"
        element={
          <ProtectedRoute allowedRoles={[1, 2]}>
            <BranchAdminEditUser />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch_profile/:branchId"
        element={
          <ProtectedRoute allowedRoles={[1, 2, 6]}>
            <BranchProfileRouter />
          </ProtectedRoute>
        }
      />

      {/* Fallback when branchId is missing (e.g. Login builds /branch_profile/ with empty id) */}
      <Route
        path="/branch_profile"
        element={
          <ProtectedRoute allowedRoles={[1, 2, 6]}>
            <BranchProfileRouter />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch_profile/:branchId/edit"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <BranchProfileEdit />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/products"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <AdminProductManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/products/add"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <AdminAddProduct />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/products/:productId"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <AdminProductDetails />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/products/:productId/edit"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <AdminProductDetails />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/products/:productId/delete"
        element={
          <ProtectedRoute allowedRoles={[2, 6]}>
            <AdminProductDetails />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/products"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <ProductManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/categories"
        element={
          <ProtectedRoute allowedRoles={[1, 2, 6]}>
            <MenuCategories />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/hotel-profile"
        element={
          <ProtectedRoute allowedRoles={[1, 2, 6]}>
            <HotelProfile />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/dashboard"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <BranchAdminDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/products/add"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <AddProduct />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/products/:productId"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <ProductDetails />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/products/:productId/edit"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <ProductDetails />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/products/:productId/delete"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <ProductDetails />
          </ProtectedRoute>
        }
      />

      <Route
        path="/kitchen/orders"
        element={
          <ProtectedRoute allowedRoles={[9, 1, 2, 3]}>
            <KitchenManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/raw-ingredient"
        element={
          <ProtectedRoute allowedRoles={[1, 2]}>
            <AddRawMaterials />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/inventory"
        element={
          <ProtectedRoute allowedRoles={[1, 2]}>
            <InventoryDashboard />
          </ProtectedRoute>
        }

        />

      <Route
        path="/branch-admin/sales-revenue"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <SalesRevenue />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/cashier-performance"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <CashierPerformance />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/recipe-mapper"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <RecipeMapper />
          </ProtectedRoute>
        }
      />

      <Route
        path="/branch-admin/recipe-mapper/:productId"
        element={
          <ProtectedRoute allowedRoles={[1]}>
            <RecipeMapperDetail />
          </ProtectedRoute>
        }
      />


      <Route
        path="/branch-admin/suppliers"
        element={
          <ProtectedRoute allowedRoles={[1, 2]}>
            <SupplierManagement />
          </ProtectedRoute>
        }

        />

            {/* The cashier's landing page was a greeting with four zeroed
                counters and a button to the till — one click in the way of the
                only screen that mattered. Old links land on the till itself. */}
            <Route path="/cashier/dashboard" element={<Navigate to="/cashier/pos" replace />} />

        <Route
          path="/cashier/pos"
          element={
            <ProtectedRoute allowedRoles={[3]}>
              <CashierPos />
            </ProtectedRoute>
          }
        />

        <Route
          path="/cashier/invoice-preview"
          element={
            <ProtectedRoute allowedRoles={[3]}>
              <InvoicePreview />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute allowedRoles={[2, 6]}>
              <AdminDashboard />
            </ProtectedRoute>
        }
      />

        <Route
          path="/admin/statistics"
          element={
            <ProtectedRoute allowedRoles={[2, 6]}>
              <AdminStatistics />
            </ProtectedRoute>
       }
      />
          <Route
           path="/waiter/pos"
          element={
            <ProtectedRoute allowedRoles={[8]}>
              <WaiterPos />
            </ProtectedRoute>
          }
        />

        <Route
           path="/admin/transactions"
          element={
            <ProtectedRoute allowedRoles={[2, 6]}>
              <AdminTransactions  />
            </ProtectedRoute>
          }
        />

        <Route
           path="/branch-admin/transactions"
          element={
            <ProtectedRoute allowedRoles={[1, 2]}>
              <BranchAdminTransactions  />
            </ProtectedRoute>
          }
        />

        <Route
          path="/branch-admin/kitchen-orders"
          element={
            <ProtectedRoute allowedRoles={[1, 2]}>
              <KitchenOrders />
            </ProtectedRoute>
          }
        />

        <Route
          path="/branch-admin/commission-agents"
          element={
            <ProtectedRoute allowedRoles={[1, 2]}>
              <CommissionAgents />
            </ProtectedRoute>
          }
        />

        <Route
          path="/branch-admin/accounting"
          element={
            <ProtectedRoute allowedRoles={[1, 2]}>
              <Accounting />
            </ProtectedRoute>
          }
        />

        {/* ── Hotel ── (cashier = role 3 works the front desk too) */}
        <Route
          path="/hotel/rack"
          element={
            <ProtectedRoute allowedRoles={[1, 2, 3]}>
              <RoomRack />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotel/calendar"
          element={
            <ProtectedRoute allowedRoles={[1, 2, 3]}>
              <HotelCalendar />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotel/guests"
          element={
            <ProtectedRoute allowedRoles={[1, 2, 3]}>
              <Guests />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotel/guests/:id"
          element={
            <ProtectedRoute allowedRoles={[1, 2, 3]}>
              <GuestProfile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/branch-admin/activity"
          element={
            <ProtectedRoute allowedRoles={[1, 2]}>
              <ActivityLog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotel/reports"
          element={
            <ProtectedRoute allowedRoles={[1, 2]}>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotel/front-desk"
          element={
            <ProtectedRoute allowedRoles={[1, 2, 3]}>
              <FrontDesk />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotel/bookings"
          element={
            <ProtectedRoute allowedRoles={[1, 2, 3]}>
              <HotelBookings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotel/bookings/:id"
          element={
            <ProtectedRoute allowedRoles={[1, 2, 3]}>
              <BookingDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotel/rooms"
          element={
            <ProtectedRoute allowedRoles={[1, 2, 3]}>
              <RoomsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotel/room-types"
          element={
            <ProtectedRoute allowedRoles={[1, 2]}>
              <RoomTypes />
            </ProtectedRoute>
          }
        />

        <Route
            path="/admin/promotions"
            element={
              <ProtectedRoute allowedRoles={[1, 2, 6]}>
                <Promotions />
              </ProtectedRoute>
            }
          />

        <Route
            path="/branch-admin/promotions"
          element={
            <ProtectedRoute allowedRoles={[1 , 2, 6]}>
                    <Promotions />
                    </ProtectedRoute>
  }
/>

      <Route path="*" element={<Navigate to="/" />} />
      
    </Routes>
    </Suspense>
  );
}

export default App;

























// import React from 'react';
// import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
// import Login from './pages/Login';
// import RegisterStep1 from './pages/RegisterStep1';
// import RegisterStep2 from './pages/RegisterStep2';
// import RegisterStep3 from './pages/RegisterStep3';
// import BranchManagement from './pages/admin/BranchManagement';
// import AddUser from './pages/admin/AddUser';
// import EditUser from './pages/admin/EditUser';


// import BranchProfile from './pages/admin/branch_profile';
// import BranchProfileEdit from './pages/admin/branchProfileEdit';
// import UserManagement from './pages/admin/UserManagement';


// function App() {
//   return (
//     <Router>
//       <Routes>
//         <Route path="/" element={<Login />} />
//         {/* <Route path="/" element={<Navigate to="/register/step-1" />} /> */}
//         <Route path="/register/step-1" element={<RegisterStep1 />} />
//         <Route path="/register/step-2" element={<RegisterStep2 />} />
//         <Route path="/register/step-3" element={<RegisterStep3 />} />
        

//         <Route path="/branches" element={<BranchManagement />} />
//         <Route path="/users" element={<UserManagement />} />
//         <Route path="/users/add" element={<AddUser />} />
//         <Route path="/users/:userId/edit" element={<EditUser/>}/>
//         <Route path="/branch_profile/:branchId" element={<BranchProfile />} />
//         <Route path="/branch_profile/:branchId/edit" element={<BranchProfileEdit />} />


//         <Route path="*" element={<Navigate to="/" />} />
//       </Routes>
//     </Router>
//   );
// }

// export default App;




