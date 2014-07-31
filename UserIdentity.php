<?php

// 登录检查
// $user = new UserIdentity();
// user->authenticate('Input you user name and password', '您必须登录才能使用该功能');
// 退出
// $user->logout();

class UserIdentity
{
    public function authenticate($desc = '', $cancel_info = '')
    {
        if (empty($_COOKIE['auth'])) {
            $_SERVER['PHP_AUTH_USER'] = '';
            $_SERVER['PHP_AUTH_PW'] = ''; 
        }

        if (!$this->isVaild()) {
            setcookie("auth", $_COOKIE['auth'] = 1);
            self::doAuth($desc, $cancel_info);
        }
    }

    public function logout()
    {
        setcookie("auth", $_COOKIE['auth'] = 0);
    }

    protected function isVaild()
    {
        if (empty($_SERVER['PHP_AUTH_USER']) || empty($_SERVER['PHP_AUTH_PW'])) {
            return false;
        }
        // 拿到 PHP_AUTH_USER PHP_AUTH_PW
        // 验证逻辑处理
        return true;
    }

    protected static function doAuth($desc, $cancel_info)
    {
        header('WWW-Authenticate: Basic realm="' . $desc . '"');
        header('HTTP/1.0 401 Unauthorized');
        header("Content-type: text/html; charset=utf-8");
        echo $cancel_info;
        exit;
    }
}