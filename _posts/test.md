---
layout: post
title: php根据SplSubject及SplObserver接口实现观察者设计模式
---

## 用户中心部署文档

### 主站:

1. 主站代码目录 /var/www/dealmoon

2. 部署主站代码

3. 建立/var/www/dealmoon/model_dm

4. 部署model_dm代码

5. 修改model_dm配置文件 dm/config/Config.php

		"dealmoon" => array(
			"username" => "root",
			"password" => "",
			"host" => "192.168.1.201",
			"dbname" => "dealmoon",
			"charset" => "latin1",
			"persistent" => false
		),
		"sso" => array(
			"username" => "root",
			"password" => "",
			"host" => "192.168.1.201",
			"dbname" => "dm_ucenter",
			"charset" => "utf-8",
			"persistent" => false
		)

6. 修改model_dm配置文件dm/config/common.php

		define("CONFIG_HOST_EN", "www.dealmoon.com");
		define("CONFIG_HOST_CN", "cn.dealmoon.com");
		define("CONFIG_HOST_MOBILE", "m.dealmoon.com");
		define('USER_HEADER_URL', "http://bbs.dealmoon.com");

7. 修改dealmoon配置 config/common.php

		define("HOSTNAME",  "www.dealmoon.com");
		define("CONFIG_HOST_EN", "www.dealmoon.com");
		define("CONFIG_HOST_CN", "cn.dealmoon.com");
		define("CONFIG_SSO_URL", "http://usso.dealmoon.com");
		define("CONFIG_USERCENTER_HOST", "umy.dealmoon.com");
		define("CONFIG_BBS_URL", "http://bbs.dealmoon.com");


8. 修改dealmoon数据库连接配置  config/mainConfig.php
		
		187行
		mysql_pconnect("localhost", "root", "bookface06")
		198行
		mysql_pconnect("localhost", "root", "bookface06")

9. 检查 views/template_c 目录是否存在并有写权限

10. 数据库修改

		ALTER TABLE `dealmoon`.`deal_comments` ADD COLUMN `uid` INT(11) NULL AFTER `submit_time`; 
		ALTER TABLE `dm_user_favorite_deals` ADD COLUMN subscriber_id INT(11) DEFAULT 0;
		ALTER TABLE `dm_subscriber_user` ADD COLUMN promoted_deal_subscribed ENUM('yes','no') DEFAULT 'yes';
		ALTER TABLE `dm_subscriber_user` ADD COLUMN notificationMethod ENUM('all','email','mobile') DEFAULT 'all';
		ALTER TABLE `dm_subscriber_user` ADD COLUMN last_retrieve_time DATETIME DEFAULT '0000-00-00 00:00:00';
		CREATE TABLE `deal_comments_relation` (
  			`id` int(11) NOT NULL AUTO_INCREMENT,
 			`uid` int(11) DEFAULT NULL,
  			`comment_id` int(11) DEFAULT NULL,
 			`parent_uid` int(11) DEFAULT NULL,
  			`parent_comment_id` int(11) DEFAULT NULL,
  			`my_related` text,
  			`status` int(11) DEFAULT NULL,
 			PRIMARY KEY (`id`)
		) ENGINE=MyISAM;


### Model DM

1. 修改 dm/config/Config.php

2. 修改 dm/config/common.php

		define("CONFIG_HOST_EN", "www.dealmoon.com");
		define("CONFIG_HOST_CN", "cn.dealmoon.com");
		define("CONFIG_HOST_MOBILE", "m.dealmoon.com");
		define('USER_HEADER_URL', "http://bbs.dealmoon.com");

3. 检查redis服务是否开启

### SSO/MY

1. 修改 application/config/database.php

2. 修改 application/config/discuz.php

3. 修改 application/config/webconfig.php

4. 检查 application/template_c 目录是否存在并有写权限

5. 检查 wwwroot/cache 目录是否存在并有写权限

6. nginx配置: document/sso.dealmoon.com.conf