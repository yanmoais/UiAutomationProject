// 认证页面JavaScript功能

// 密码显示/隐藏切换
function togglePassword(inputId = 'password') {
    const input = document.getElementById(inputId);
    const toggleBtn = input.parentElement.querySelector('.password-toggle i');
    
    if (input.type === 'password') {
        input.type = 'text';
        toggleBtn.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        toggleBtn.className = 'fas fa-eye';
    }
}

// 显示消息
function showMessage(message, type = 'error') {
    const messageEl = document.getElementById('message');
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';
    
    // 3秒后自动隐藏
    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 3000);
}

// 设置按钮加载状态
function setButtonLoading(button, loading = true) {
    if (loading) {
        button.disabled = true;
        button.classList.add('loading');
        button.innerHTML = '<i class="fas fa-spinner"></i> 处理中...';
    } else {
        button.disabled = false;
        button.classList.remove('loading');
        // 恢复原始文本
        if (button.closest('#loginForm')) {
            button.innerHTML = '<i class="fas fa-sign-in-alt"></i> 登录';
        } else if (button.closest('#registerForm')) {
            button.innerHTML = '<i class="fas fa-user-plus"></i> 注册';
        }
    }
}

// 表单验证
function validateForm(formData) {
    const errors = [];
    
    // 用户名验证
    if (formData.username && formData.username.length < 3) {
        errors.push('用户名至少需要3个字符');
    }
    
    // 邮箱验证
    if (formData.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(formData.email)) {
            errors.push('请输入有效的邮箱地址');
        }
    }
    
    // 密码验证
    if (formData.password && formData.password.length < 6) {
        errors.push('密码至少需要6个字符');
    }
    
    // 确认密码验证
    if (formData.confirmPassword && formData.password !== formData.confirmPassword) {
        errors.push('两次输入的密码不一致');
    }
    
    return errors;
}

// 登录表单处理
if (document.getElementById('loginForm')) {
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const formData = {
            username: document.getElementById('username').value.trim(),
            password: document.getElementById('password').value
        };
        
        // 验证表单
        const errors = validateForm(formData);
        if (errors.length > 0) {
            showMessage(errors[0]);
            return;
        }
        
        const submitBtn = this.querySelector('button[type="submit"]');
        setButtonLoading(submitBtn, true);
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });
            
            const data = await response.json();
            
            if (data.success) {
                showMessage(data.message, 'success');
                // 登录成功后跳转到主页
                setTimeout(() => {
                    window.location.href = '/';
                }, 1000);
            } else {
                showMessage(data.message);
            }
        } catch (error) {
            showMessage('网络错误，请稍后重试');
            console.error('Login error:', error);
        } finally {
            setButtonLoading(submitBtn, false);
        }
    });
}

// 注册表单处理
if (document.getElementById('registerForm')) {
    document.getElementById('registerForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const formData = {
            username: document.getElementById('username').value.trim(),
            email: document.getElementById('email').value.trim(),
            password: document.getElementById('password').value,
            confirmPassword: document.getElementById('confirm_password').value
        };
        
        // 验证表单
        const errors = validateForm(formData);
        if (errors.length > 0) {
            showMessage(errors[0]);
            return;
        }
        
        const submitBtn = this.querySelector('button[type="submit"]');
        setButtonLoading(submitBtn, true);
        
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });
            
            const data = await response.json();
            
            if (data.success) {
                showMessage(data.message, 'success');
                // 注册成功后跳转到登录页
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            } else {
                showMessage(data.message);
            }
        } catch (error) {
            showMessage('网络错误，请稍后重试');
            console.error('Register error:', error);
        } finally {
            setButtonLoading(submitBtn, false);
        }
    });
}

// 实时表单验证
function setupRealTimeValidation() {
    const inputs = document.querySelectorAll('.auth-form input');
    
    inputs.forEach(input => {
        input.addEventListener('blur', function() {
            validateField(this);
        });
        
        input.addEventListener('input', function() {
            // 清除之前的验证状态
            this.classList.remove('valid', 'invalid');
        });
    });
}

function validateField(field) {
    const value = field.value.trim();
    let isValid = true;
    
    switch (field.name) {
        case 'username':
            if (value.length > 0 && value.length < 3) {
                isValid = false;
            }
            break;
        case 'email':
            if (value.length > 0) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                isValid = emailRegex.test(value);
            }
            break;
        case 'password':
            if (value.length > 0 && value.length < 6) {
                isValid = false;
            }
            break;
        case 'confirm_password':
            const password = document.getElementById('password')?.value;
            if (value.length > 0 && value !== password) {
                isValid = false;
            }
            break;
    }
    
    if (value.length > 0) {
        field.classList.toggle('valid', isValid);
        field.classList.toggle('invalid', !isValid);
    }
}

// 页面加载完成后设置实时验证
document.addEventListener('DOMContentLoaded', function() {
    setupRealTimeValidation();
    
    // 检查是否已登录
    checkAuthStatus();
});

// 检查认证状态
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/check-auth');
        const data = await response.json();
        
        if (data.success && data.authenticated) {
            // 如果已登录，跳转到主页
            if (window.location.pathname.includes('login.html') || 
                window.location.pathname.includes('register.html')) {
                window.location.href = '/';
            }
        }
    } catch (error) {
        console.error('Auth check error:', error);
    }
} 