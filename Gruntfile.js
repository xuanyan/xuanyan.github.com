module.exports = function(grunt){
grunt.initConfig({ 
	
copy: {
    main: {
	  files: [
	    {expand: true, cwd: 'bower_components/jquery/dist/', src: ['**'], dest: 'vendor/jquery'},
	    {expand: true, cwd: 'bower_components/bootstrap/dist/', src: ['**'], dest: 'vendor/bootstrap'}
	  ]
    }
}


});

grunt.loadNpmTasks('grunt-contrib-copy');

};