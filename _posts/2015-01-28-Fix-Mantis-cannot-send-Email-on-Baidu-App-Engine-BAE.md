---
layout: post
title: 解决mantis在百度应用引擎(BAE)下无法发送Email的问题
---

最近自己搭建在 BAE 下的mantis一直发送不了邮件，因为使用频率不高一直没在意。以为是因为最近Gmail在国内被墙造成的(mantis使用Gmail的smtp账号进行发送)，昨天换了n多账号，改了n次mantis的配置文件，都无法发送。

发现问题不在账号，而是百度应用引擎(BAE)屏蔽了php的很多函数。造成phpmailer的smtp相关代码失效。

我的解决方案是在不改变mantis代码的基础上，使用cron任务，配合简单脚本，直接对mantis的email表进行处理。本来打算使用 BAE 的消息队列进行mail发送，经过简单测试，发现 BAE 的消息队列发送email会对email的内容进行关键词审核，造成大量了email发送失败。

没办法，最终在Sina App Engine搭建了个简单的脚本，接受外部post参数，使用seamail的quickSend进行邮件发送。

cron任务使用 BAE 的app.conf实现。具体代码：

```

crond :
  service : on
  crontab :
    - "*/1 * * * * php /home/bae/app/scripts/mail.php"

```

发送邮件的部分代码：

<!-- more -->

```

// /home/bae/app/scripts/mail.php

require_once dirname(__DIR__).'/config_inc.php';

$g_hostname = explode(':', $g_hostname);
$dsn = 'mysql:dbname='.$g_database_name.';host='.$g_hostname[0].';port='.$g_hostname[1];
$user = $g_db_username;
$password = $g_db_password;

try {
    $db = new PDO($dsn, $user, $password);
} catch (PDOException $e) {
    echo 'Connection failed: ' . $e->getMessage();
}

$sql = "SELECT * FROM mantis_email_table ORDER BY email_id DESC LIMIT 1";
$query = $db->query($sql);

$mail = new myMail('用户名', '密码');
foreach ($query as $row) {
    $mail->send($row['email'], $row['subject'], $row['body']);
    $sql = "DELETE FROM mantis_email_table WHERE email_id = '{$row['email_id']}'";
    $db->exec($sql);
}

```

希望对大家有帮助，欢迎讨论。