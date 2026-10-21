from django.urls import path

from . import admin_auth, admin_users, views

auth_urlpatterns = [
    path("otp/request/", views.OtpRequestView.as_view(), name="otp-request"),
    path("otp/verify/", views.OtpVerifyView.as_view(), name="otp-verify"),
    path("register/", views.RegisterView.as_view(), name="register"),
    path("login/", views.LoginView.as_view(), name="login"),
    path("token/refresh/", views.TokenRefreshView.as_view(), name="token-refresh"),
    path("logout/", views.LogoutView.as_view(), name="logout"),
    path("password/reset/", views.PasswordResetView.as_view(), name="password-reset"),
    path("password/change/", views.PasswordChangeView.as_view(), name="password-change"),
]

# Admin Panel sign-in (session + CSRF), mounted under /admin/auth/.
admin_auth_urlpatterns = [
    path("csrf/", admin_auth.AdminCsrfView.as_view(), name="admin-auth-csrf"),
    path("login/", admin_auth.AdminLoginView.as_view(), name="admin-auth-login"),
    path("logout/", admin_auth.AdminLogoutView.as_view(), name="admin-auth-logout"),
    path("me/", admin_auth.AdminMeView.as_view(), name="admin-auth-me"),
]

# Admin Panel: read-only user list and detail (Milestone 7E), mounted under /admin/.
admin_users_urlpatterns = [
    path("users/", admin_users.AdminUserListView.as_view(), name="user-list"),
    path("users/<int:pk>/", admin_users.AdminUserDetailView.as_view(), name="user-detail"),
]
